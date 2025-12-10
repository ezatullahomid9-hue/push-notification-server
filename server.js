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
  res.send("Expo Push Notification Server is running ✔");
});

// --------------------------------------
// Save Expo push token (multi-device support)
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
// Send notification to a single Expo token
// --------------------------------------
app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, token } = req.body;

    if (!title || !body || !token) {
      return res.status(400).json({ error: "title, body and token are required" });
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: token,
        sound: "default",
        title,
        body,
      }),
    });

    const result = await response.json();
    res.json({ success: true, result });
  } catch (err) {
    console.error("Expo Push Error:", err);
    res.status(500).json({ error: "failed to send expo notification" });
  }
});

// --------------------------------------
// Send notification to all devices of a user
// --------------------------------------
app.post("/send-to-user", async (req, res) => {
  try {
    const { userId, title, body } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ error: "userId, title, body are required" });
    }

    const userDoc = await db.collection("deviceTokens").doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: "No tokens found for this user" });

    const tokens = userDoc.data().tokens || [];
    if (tokens.length === 0) return res.status(404).json({ error: "User has no registered devices" });

    const results = [];
    const invalidTokens = [];

    for (const token of tokens) {
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: token, sound: "default", title, body }),
        });
        const result = await response.json();
        results.push(result);

        // Remove invalid Expo tokens automatically
        if (result.data && result.data.status === "error") invalidTokens.push(token);
      } catch (err) {
        console.error("Error sending to token:", token, err);
        invalidTokens.push(token);
      }
    }

    if (invalidTokens.length > 0) {
      await db
        .collection("deviceTokens")
        .doc(userId)
        .update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens) });
      console.log("Removed invalid tokens:", invalidTokens);
    }

    res.json({ success: true, sentTo: tokens.length, removed: invalidTokens.length, results });
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
