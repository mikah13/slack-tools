export async function updateSlackPhoto({
  image,
  token,
}: {
  image: string;
  token: string;
}) {
  try {
    // Fetch the image
    const imageResponse = await fetch(image);
    const imageBlob = await imageResponse.blob();

    // Create form data
    const formData = new FormData();
    formData.append("image", imageBlob);

    // Make request to Slack API
    const response = await fetch("https://slack.com/api/users.setPhoto", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Failed to update profile picture");
    }

    console.log(`Successfully updated profile picture to: ${image}`);
    return true;
  } catch (error) {
    console.error("Error updating profile picture:", error);
    return false;
  }
}

export async function updateSlackStatus({
  status,
  token,
}: {
  status: { text: string; emoji: string };
  token: string;
}) {
  try {
    const response = await fetch("https://slack.com/api/users.profile.set", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
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
    if (!data.ok) {
      throw new Error(data.error || "Failed to update status");
    }

    console.log(
      `Successfully updated status to: ${status.text} ${status.emoji}`
    );
    return true;
  } catch (error) {
    console.error("Error updating status:", error);
    return false;
  }
}
