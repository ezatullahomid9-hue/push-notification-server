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
db.settings({ ignoreUndefinedProperties: true }); // optional but recommended

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
// Example: Saving a token
// --------------------------------------
app.post("/save-token", async (req, res) => {
  try {
    const { token, userId } = req.body;

    if (!token || !userId) {
      return res.status(400).json({ error: "token and userId are required" });
    }

    await db.collection("deviceTokens").doc(userId).set({ token });

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving token:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// --------------------------------------
// Example: Sending notification
// --------------------------------------
app.post("/send-notification", async (req, res) => {
  try {
    const { title, body, token } = req.body;

    if (!title || !body || !token) {
      return res.status(400).json({ error: "title, body and token are required" });
    }

    const message = {
      notification: { title, body },
      token,
    };

    const response = await admin.messaging().send(message);

    res.json({ success: true, response });
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).json({ error: "notification send error" });
  }
});

// --------------------------------------
// Start server (Render requirement)
// --------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} ✔`);
});
