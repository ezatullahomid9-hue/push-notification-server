import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import admin from "firebase-admin";

/* --------------------------------------
   Firebase Admin Init
-------------------------------------- */
if (!process.env.SERVICE_ACCOUNT_JSON) {
  throw new Error("SERVICE_ACCOUNT_JSON env variable missing");
}

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

/* --------------------------------------
   App Setup
-------------------------------------- */
const app = express();
app.use(cors());
app.use(express.json());

/* --------------------------------------
   HEALTH CHECK
-------------------------------------- */
app.get("/", (_, res) => {
  res.send("🚀 Expo Push Notification Server Running");
});

app.get("/health", (_, res) => {
  res.status(200).send("OK");
});

/* --------------------------------------
   Validate Expo Token
-------------------------------------- */
const isValidExpoToken = (token) =>
  typeof token === "string" &&
  token.startsWith("ExponentPushToken");

/* --------------------------------------
   SAVE PUSH TOKEN (REPLACE OLD)
-------------------------------------- */
app.post("/save-token", async (req, res) => {
  try {
    const { token, userId } = req.body;

    if (!token || !userId || !isValidExpoToken(token)) {
      return res.status(400).json({
        error: "Valid Expo token and userId required",
      });
    }

    await db.collection("deviceTokens").doc(userId).set(
      {
        tokens: [token], // ✅ replace old tokens
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* --------------------------------------
   SEND NOTIFICATION (USER OR ALL)
-------------------------------------- */
app.post("/send-to-user", async (req, res) => {
  try {
    const { userId, title, body, image, data } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({
        error: "userId, title, body are required",
      });
    }

    let docs = [];

    if (userId === "all") {
      const snap = await db.collection("deviceTokens").get();
      docs = snap.docs;
    } else {
      const snap = await db.collection("deviceTokens").doc(userId).get();
      if (!snap.exists) {
        return res.status(404).json({ error: "No tokens found" });
      }
      docs = [snap];
    }

    let sent = 0;
    let removed = 0;

    for (const docSnap of docs) {
      const tokens = docSnap.data().tokens || [];
      const invalidTokens = [];

      for (const token of tokens) {
        if (!isValidExpoToken(token)) {
          invalidTokens.push(token);
          continue;
        }

        const payload = {
          to: token,
          sound: "default",
          title,
          body,
          priority: "high",
          data: data || {},
        };

        if (image) payload.image = image;

        try {
          const response = await fetch(
            "https://exp.host/--/api/v2/push/send",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );

          const result = await response.json();

          if (
            result?.data?.status === "error" &&
            result?.data?.details?.error === "DeviceNotRegistered"
          ) {
            invalidTokens.push(token);
          } else {
            sent++;
          }
        } catch (err) {
          invalidTokens.push(token);
        }
      }

      if (invalidTokens.length > 0) {
        await db.collection("deviceTokens").doc(docSnap.id).update({
          tokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
        });
        removed += invalidTokens.length;
      }
    }

    res.json({
      success: true,
      sent,
      removed,
    });
  } catch (err) {
    console.error("Send notification error:", err);
    res.status(500).json({ error: "Notification failed" });
  }
});

/* --------------------------------------
   START SERVER
-------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
