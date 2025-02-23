import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from './utils/headers.ts';
import { getRandomIndex } from './utils/helper.ts';

// Configuration
const CONFIG = {
  IMAGES_PER_MINUTE: 10,
  SLACK_APP_TOKEN: Deno.env.get('SLACK_APP_TOKEN') || '',
};

// Derived Constants
const INTERVAL = (60 * 1000) / CONFIG.IMAGES_PER_MINUTE;

// Data Store
const images: string[] = []; // List of image URLs
const statuses: { text: string; emoji: string }[] = []; // List of statuses
let currentStatusIndex = 0;
let lastImageIndex: number = -1;

/**
 * Uploads a new Slack profile picture.
 * @param imageUrl The image URL to upload.
 */
async function updateSlackPhoto(imageUrl: string): Promise<boolean> {
  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok)
      throw new Error(`Failed to fetch image: ${imageUrl}`);

    const imageBlob = await imageResponse.blob();
    const formData = new FormData();
    formData.append('image', imageBlob);

    const response = await fetch('https://slack.com/api/users.setPhoto', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.SLACK_APP_TOKEN}` },
      body: formData,
    });

    const data = await response.json();
    if (!data.ok)
      throw new Error(data.error || 'Failed to update profile picture');

    console.log(`Profile picture updated: ${imageUrl}`);
    return true;
  } catch (error) {
    console.error('Profile picture update failed:', error);
    return false;
  }
}

/**
 * Updates the Slack status.
 */
async function updateSlackStatus(): Promise<boolean> {
  try {
    const status = statuses[currentStatusIndex];

    const response = await fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.SLACK_APP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profile: {
          status_text: status.text,
          status_emoji: status.emoji,
          status_expiration: 0,
        },
      }),
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Failed to update status');

    console.log(`Status updated: ${status.text} ${status.emoji}`);
    return true;
  } catch (error) {
    console.error('Status update failed:', error);
    return false;
  }
}

/**
 * Cycles the Slack profile picture and status.
 */
async function cycleProfile() {
  if (!images.length || !statuses.length) {
    console.warn('No images or statuses available for cycling.');
    return;
  }

  const currentImageIndex = getRandomIndex(images, lastImageIndex);
  const imageUrl = images[currentImageIndex];

  const [photoResult, statusResult] = await Promise.allSettled([
    updateSlackPhoto(imageUrl),
    updateSlackStatus(),
  ]);

  if (photoResult.status === 'rejected')
    console.error('Photo update failed:', photoResult.reason);
  if (statusResult.status === 'rejected')
    console.error('Status update failed:', statusResult.reason);

  currentStatusIndex = (currentStatusIndex + 1) % statuses.length;
}

setInterval(cycleProfile, INTERVAL);

cycleProfile();

serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
        status: 'running',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
