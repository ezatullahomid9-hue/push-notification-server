// --------------------------------------
// Send notification to USER or ALL USERS
// --------------------------------------
app.post("/send-to-user", async (req, res) => {
  try {
    const { userId, title, body, image, data } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({
        error: "userId, title, body are required",
      });
    }

    let userDocs = [];

    if (userId === "all") {
      const snapshot = await db.collection("deviceTokens").get();
      userDocs = snapshot.docs;
    } else {
      const docSnap = await db.collection("deviceTokens").doc(userId).get();
      if (!docSnap.exists) {
        return res.status(404).json({ error: "No tokens found for this user" });
      }
      userDocs = [docSnap];
    }

    let totalTokens = 0;
    let removedTokens = 0;

    for (const userDoc of userDocs) {
      const tokens = userDoc.data().tokens || [];
      totalTokens += tokens.length;
      const invalidTokens = [];

      for (const token of tokens) {
        try {
          const payload = {
            to: token,
            sound: "default",
            title,
            body,
            data: data || {}, // 🔥 navigation + discount
          };

          // 🔥 Add image only if provided
          if (image) {
            payload.image = image;
          }

          const response = await fetch(
            "https://exp.host/--/api/v2/push/send",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );

          const result = await response.json();

          if (result.data?.status === "error") {
            invalidTokens.push(token);
          }
        } catch (err) {
          console.error("Error sending to token:", token, err);
          invalidTokens.push(token);
        }
      }

      if (invalidTokens.length > 0) {
        await db
          .collection("deviceTokens")
          .doc(userDoc.id)
          .update({
            tokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
          });
        removedTokens += invalidTokens.length;
      }
    }

    res.json({
      success: true,
      totalTokens,
      removedTokens,
    });
  } catch (err) {
    console.error("Error sending notifications:", err);
    res.status(500).json({ error: "error sending notification" });
  }
});
