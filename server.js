import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert("./serviceAccount.json"),
});

const db = admin.firestore();
const app = express();

app.use(express.json());

// Watch Firestore for new product
db.collection("products").onSnapshot(async (snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === "added") {
      const product = change.doc.data();
      const productId = change.doc.id;

      const tokenDocs = await db.collection("pushTokens").get();
      const tokens = tokenDocs.docs.map((doc) => doc.data().token);

      const messages = tokens.map((token) => ({
        to: token,
        sound: "default",
        title: "New Product Added",
        body: `Product ${product.product_code} is available`,
        data: { productId },
      }));

      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });

      console.log("Sent notifications to:", tokens.length);
    }
  });
});

app.get("/", (req, res) => res.send("Server running"));

app.listen(3000, () => console.log("Notification server running"));
