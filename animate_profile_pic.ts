/**
 * Animate Profile Picture
 *
 * This script uses the SLACK_APP_TOKEN to send requests to the server every {INTERVAL}
 * to update the user's status and profile images dynamically. It cycles through a set
 * of images and statuses to enhance the user's Slack experience.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "./utils/headers.ts";
import { getRandomIndex } from "./utils/helper.ts";
import { updateSlackPhoto, updateSlackStatus } from "./utils/slack.ts";

// Configuration
const CONFIG = {
  IMAGES_PER_MINUTE: 10,
  SLACK_APP_TOKEN: Deno.env.get("SLACK_TOKEN") || "",
};

// Derived Constants
const INTERVAL = (60 * 1000) / CONFIG.IMAGES_PER_MINUTE;

// Data Store
const images: string[] = []; // List of image URLs
const statuses: { text: string; emoji: string }[] = []; // List of statuses
let currentStatusIndex = 0;
let lastImageIndex: number = -1;

/**
 * Cycles the Slack profile picture and status.
 */
async function cycleProfile() {
  if (!images.length || !statuses.length) {
    console.warn("No images or statuses available for cycling.");
    return;
  }

  const currentImageIndex = getRandomIndex(images, lastImageIndex);
  const imageUrl = images[currentImageIndex];

  const [photoResult, statusResult] = await Promise.allSettled([
    updateSlackPhoto({ image: imageUrl, token: CONFIG.SLACK_APP_TOKEN }),
    updateSlackStatus({
      token: CONFIG.SLACK_APP_TOKEN,
      status: statuses[currentStatusIndex],
    }),
  ]);

  if (photoResult.status === "rejected")
    console.error("Photo update failed:", photoResult.reason);
  if (statusResult.status === "rejected")
    console.error("Status update failed:", statusResult.reason);

  currentStatusIndex = (currentStatusIndex + 1) % statuses.length;
}

setInterval(cycleProfile, INTERVAL);

cycleProfile();

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    return new Response(
      JSON.stringify({
        success: true,
        currentImage: images[lastImageIndex],
        currentStatus: statuses[currentStatusIndex],
        totalImages: images.length,
        totalStatuses: statuses.length,
        interval: INTERVAL,
        status: "running",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
