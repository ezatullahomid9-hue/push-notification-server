import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";

// Load service account from environment variable
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------------------
// Test route
// --------------------------------------
app.get("/", (req, res) => {
  res.send("Push Notification Server is running ✔");
});

// --------------------------------------
// Save device token (multi-device support)
// --------------------------------------
app.post("/save-token", async (req, res) => {
  try {
    const { token, userId } = req.body;

    if (!token || !userId) {
      return res.status(400).json({ error: "token and userId are required" });
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
// Send notification directly to ONE token
// --------------------------------------
app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, token, data } = req.body;

    if (!title || !body || !token) {
      return res.status(400).json({ error: "title, body and token are required" });
    }

    const message = {
      notification: { title, body },
      token,
      data: data || {},

      android: {
        priority: "high",
        notification: { sound: "default" },
      },

      apns: {
        payload: { aps: { sound: "default", contentAvailable: true } },
      },
    };

    const response = await admin.messaging().send(message);

    res.json({ success: true, response });
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).json({ error: "notification send error" });
  }
});

// --------------------------------------
// Send notification to USER (all devices)
// --------------------------------------
app.post("/send-to-user", async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ error: "userId, title, body are required" });
    }

    // Get user tokens
    const userDoc = await db.collection("deviceTokens").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "No tokens found for this user" });
    }

    const tokens = userDoc.data().tokens || [];

    if (tokens.length === 0) {
      return res.status(404).json({ error: "User has no registered devices" });
    }

    const invalidTokens = [];

    for (const token of tokens) {
      try {
        await admin.messaging().send({
          notification: { title, body },
          token,
          data: data || {},

          android: {
            priority: "high",
            notification: { sound: "default" },
          },

          apns: {
            payload: { aps: { sound: "default", contentAvailable: true } },
          },
        });
      } catch (err) {
        console.error("Error sending to token:", token, err);

        // Track invalid tokens for cleanup
        if (
          err.errorInfo &&
          (err.errorInfo.code === "messaging/invalid-registration-token" ||
            err.errorInfo.code === "messaging/registration-token-not-registered")
        ) {
          invalidTokens.push(token);
        }
      }
    }

    // Remove invalid tokens
    if (invalidTokens.length > 0) {
      await db
        .collection("deviceTokens")
        .doc(userId)
        .update({
          tokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
        });

      console.log("Removed invalid tokens:", invalidTokens);
    }

    res.json({ success: true, sentTo: tokens.length, removed: invalidTokens.length });
  } catch (err) {
    console.error("Error sending to user:", err);
    res.status(500).json({ error: "error sending notification to user" });
  }
});

// --------------------------------------
// Start server
// --------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} ✔`);
});
