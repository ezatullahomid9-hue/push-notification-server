import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";

// --------------------------------------
// Firebase Admin Init
// --------------------------------------
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// --------------------------------------
// App Setup
// --------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// --------------------------------------
// Health check (keep server awake)
// --------------------------------------
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// --------------------------------------
// Root test route
// --------------------------------------
app.get("/", (req, res) => {
  res.send("Expo Push Notification Server is running ✔");
});

// --------------------------------------
// Save Expo Push Token (multi-device)
// --------------------------------------
app.post("/save-token", async (req, res) => {
  try {
    const { token, userId } = req.body;

    if (!token || !userId) {
      return res.status(400).json({
        error: "token and userId are required",
      });
    }

    await db.collection("deviceTokens").doc(userId).set(
      {
        tokens: admin.firestore.FieldValue.arrayUnion(token),
      },
      { merge: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving token:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// --------------------------------------
// Send notification to ONE token (test)
// --------------------------------------
app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, token, image, data } = req.body;

    if (!title || !body || !token) {
      return res.status(400).json({
        error: "title, body and token are required",
      });
    }

    const payload = {
      to: token,
      sound: "default",
      title,
      body,
      data: data || {},
    };

    if (image) payload.image = image;

    const response = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    res.json({ success: true, result });
  } catch (err) {
    console.error("Expo Push Error:", err);
    res.status(500).json({ error: "failed to send expo notification" });
  }
});

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
        return res.status(404).json({
          error: "No tokens found for this user",
        });
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

          // 🔥 Image support (logo)
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
    res.status(500).json({
      error: "error sending notification",
    });
  }
});

// --------------------------------------
// Start Server
// --------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} ✔`);
});
