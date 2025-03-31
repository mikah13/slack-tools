import { encode as encodeBase64 } from "https://deno.land/std@0.190.0/encoding/base64.ts";
import { updateSlackPhoto, updateSlackStatus } from "./utils/slack.ts";
import { corsHeaders } from "./utils/headers.ts";
import { generateRandomString, generateCodeChallenge } from "./utils/crypto.ts";

const CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET") || "";
const SLACK_TOKEN = Deno.env.get("SLACK_TOKEN") || "";
const BASE_URL = Deno.env.get("BASE_URL") || "http://localhost:8000";
const REDIRECT_URI = `${BASE_URL}/callback`;

// API endpoints
const SPOTIFY_AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const SPOTIFY_NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";

// Scopes for Spotify API
const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
].join(" ");

interface TokenStorage {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number;
  codeVerifier: string | null;
  lastPlayedTrack: any | null;
}

// Initialize with default values - all tokens will be managed in memory
const tokenStorage: TokenStorage = {
  accessToken: null,
  refreshToken: null,
  tokenExpiry: 0,
  codeVerifier: null,
  lastPlayedTrack: null,
};

/**
 * Generate the authorization URL for PKCE flow
 */
async function getAuthorizationUrl(): Promise<{
  url: string;
  codeVerifier: string;
}> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    scope: SPOTIFY_SCOPES,
  });

  return {
    url: `${SPOTIFY_AUTH_ENDPOINT}?${params.toString()}`,
    codeVerifier,
  };
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(
  code: string,
  codeVerifier: string
): Promise<any> {
  try {
    const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return data;
    } else {
      console.error("Error exchanging code for token:", data);
      return null;
    }
  } catch (error) {
    console.error("Failed to exchange code for token:", error);
    return null;
  }
}

/**
 * Refresh the Spotify access token using the stored refresh token
 */
async function refreshSpotifyToken(): Promise<string | null> {
  // Use existing token if it's still valid
  if (tokenStorage.accessToken && tokenStorage.tokenExpiry > Date.now()) {
    return tokenStorage.accessToken;
  }

  // If we don't have a refresh token, we can't refresh
  if (!tokenStorage.refreshToken) {
    console.error("No refresh token available");
    return null;
  }

  try {
    const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${encodeBase64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenStorage.refreshToken,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      tokenStorage.accessToken = data.access_token;
      tokenStorage.tokenExpiry = Date.now() + data.expires_in * 1000;

      // Some implementations return a new refresh token, update if available
      if (data.refresh_token) {
        tokenStorage.refreshToken = data.refresh_token;
        // In a real implementation, you would save this to persistent storage
        console.log("New refresh token received and stored");
      }

      return tokenStorage.accessToken;
    } else {
      console.error("Error refreshing token:", data);
      return null;
    }
  } catch (error) {
    console.error("Failed to refresh token:", error);
    return null;
  }
}

/**
 * Get the currently playing track from Spotify
 */
async function getCurrentlyPlaying(): Promise<any> {
  const token = await refreshSpotifyToken();
  if (!token) {
    return null;
  }

  console.log({ token });
  try {
    const response = await fetch(SPOTIFY_NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log({ response });
    // No track currently playing
    if (response.status === 204) {
      return { isPlaying: false };
    }

    if (response.ok) {
      const data = await response.json();
      console.log({ data });
      return {
        isPlaying: data.is_playing,
        trackName: data.item?.name,
        artistName: data.item?.artists
          .map((artist: any) => artist.name)
          .join(", "),
        albumName: data.item?.album?.name,
        trackUrl: data.item?.external_urls?.spotify,
        albumArtUrl: data.item?.album?.images[0]?.url, // Get album art URL
        albumArt: data.item?.album?.images, // Get all image sizes
      };
    } else {
      console.error("Error fetching currently playing:", await response.text());
      return null;
    }
  } catch (error) {
    console.error("Failed to fetch currently playing:", error);
    return null;
  }
}

/**
 * Update Slack status with currently playing song
 */
async function updateStatus(trackInfo: any): Promise<boolean> {
  if (!SLACK_TOKEN) {
    console.error("No Slack token available");
    return false;
  }

  try {
    let statusText = "";
    let statusEmoji = "";

    if (trackInfo?.isPlaying && trackInfo?.trackName) {
      // Format status text with song and artist
      statusText = `Playing: ${trackInfo.trackName} by ${trackInfo.artistName}`;
      statusEmoji = ":cat-arm-dance:"; // or ":headphones:" or another emoji
    } else {
      // Clear the status when nothing is playing
      statusText = "";
      statusEmoji = "";
    }

    const result = await updateSlackStatus({
      token: SLACK_TOKEN,
      status: {
        text: statusText,
        emoji: statusEmoji,
      },
    });

    return result;
  } catch (error) {
    console.error("Error updating status:", error);
    return false;
  }
}

/**
 * Main handler function for the edge function
 */
export default async function handler(req: Request): Promise<Response> {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse the URL to get path and query parameters
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  // Handle different routes
  try {
    // Authentication flow
    if (path === "auth") {
      // Generate authorization URL with PKCE
      const { url: authUrl, codeVerifier } = await getAuthorizationUrl();
      tokenStorage.codeVerifier = codeVerifier;

      return new Response(
        JSON.stringify({
          success: true,
          authUrl,
          message: "Please visit this URL to authorize the application",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Callback from Spotify authorization
    if (path === "callback") {
      const code = url.searchParams.get("code");

      if (!code) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "No authorization code provided",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (!tokenStorage.codeVerifier) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "No code verifier found. Please restart the authentication flow.",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      // Exchange the code for tokens
      const tokenData = await exchangeCodeForToken(
        code,
        tokenStorage.codeVerifier
      );

      if (!tokenData) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to exchange authorization code for tokens",
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      // Store the tokens
      tokenStorage.accessToken = tokenData.access_token;
      tokenStorage.refreshToken = tokenData.refresh_token;
      tokenStorage.tokenExpiry = Date.now() + tokenData.expires_in * 1000;
      tokenStorage.codeVerifier = null; // Clear the code verifier as it's no longer needed

      return new Response(
        JSON.stringify({
          success: true,
          message: "Authentication successful! You can now close this window.",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Set refresh token endpoint (for manual token setting)
    if (path === "set-token" && req.method === "POST") {
      try {
        const body = await req.json();

        if (body.refreshToken) {
          tokenStorage.refreshToken = body.refreshToken;

          // Test the token by trying to refresh it
          const accessToken = await refreshSpotifyToken();

          if (accessToken) {
            return new Response(
              JSON.stringify({
                success: true,
                message: "Refresh token set and validated successfully",
              }),
              {
                status: 200,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              }
            );
          } else {
            return new Response(
              JSON.stringify({
                success: false,
                error: "Refresh token was set but could not be validated",
              }),
              {
                status: 400,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              }
            );
          }
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              error: "No refresh token provided",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid JSON body",
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    // Default route - get currently playing and update Slack
    console.log("Spotify tracker function called");

    // Get currently playing track from Spotify
    const trackInfo = await getCurrentlyPlaying();
    let slackStatusResult = false;
    let slackPhotoResult = false;

    // If we have track information
    if (trackInfo !== null) {
      // Update Slack status
      slackStatusResult = await updateStatus(trackInfo);

      // If a track is playing, update the profile photo and save as last played track
      if (trackInfo.isPlaying && trackInfo.albumArtUrl) {
        slackPhotoResult = await updateSlackPhoto({
          image: trackInfo.albumArtUrl,
          token: SLACK_TOKEN,
        });

        // Save this as the last played track
        tokenStorage.lastPlayedTrack = trackInfo;
      }
    } else {
      // Just update the status to not playing, but don't reset the profile photo
      slackStatusResult = await updateStatus({ isPlaying: false });
    }

    // Return the results
    return new Response(
      JSON.stringify({
        success: true,
        currentlyPlaying: trackInfo || { isPlaying: false },
        slackUpdated: {
          status: slackStatusResult,
          photo: slackPhotoResult,
        },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An unknown error occurred",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
}

/**
 * Function to check if authenticated and update Slack status at regular intervals
 */
async function updateSpotifyStatus(): Promise<void> {
  // Check if we're authenticated
  if (!tokenStorage.refreshToken) {
    console.log("Not authenticated. Please authenticate first.");
    return;
  }

  try {
    // Get currently playing track from Spotify
    const trackInfo = await getCurrentlyPlaying();

    // If no track info or error occurred, just exit
    if (trackInfo === null) {
      console.log("Error getting track info or not authenticated properly.");
      return;
    }

    // If no track is currently playing, just exit
    if (!trackInfo.isPlaying) {
      console.log("No track currently playing.");
      return;
    }

    // Update Slack status
    const slackStatusResult = await updateStatus(trackInfo);
    console.log(
      `Slack status update: ${slackStatusResult ? "success" : "failed"}`
    );

    // Update profile photo with album art if available
    if (trackInfo.albumArtUrl) {
      const slackPhotoResult = await updateSlackPhoto({
        image: trackInfo.albumArtUrl,
        token: SLACK_TOKEN,
      });
      console.log(
        `Slack photo update: ${slackPhotoResult ? "success" : "failed"}`
      );

      // Save this as the last played track
      tokenStorage.lastPlayedTrack = trackInfo;
    }

    console.log(
      `Updated with: ${trackInfo.trackName} by ${trackInfo.artistName}`
    );
  } catch (error) {
    console.error("Error in updateSpotifyStatus:", error);
  }
}

// For local development only - this won't run in edge functions
if (import.meta.main) {
  const PORT = 8000;
  console.log("SPOTIFY_CLIENT_ID: ", CLIENT_ID);
  console.log(`Starting local development server on port ${PORT}...`);
  console.log(`Authentication URL: http://localhost:${PORT}/auth`);
  console.log(
    `Set token URL: http://localhost:${PORT}/set-token (POST with JSON body: { "refreshToken": "your-refresh-token" })`
  );
  console.log(`Update Slack status: http://localhost:${PORT}/ (GET)`);

  Deno.serve({ port: PORT }, async (req) => {
    return await handler(req);
  });

  // Run updateSpotifyStatus every 15 seconds
  console.log("Setting up automatic status updates every 15 seconds...");
  setInterval(updateSpotifyStatus, 15000);
}
