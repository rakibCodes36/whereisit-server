const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5001;


app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://whereisit-bd.netlify.app",
      "https://whereisit-b976c.firebaseapp.com",
      "whereisit-b976c.web.app",
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send({ success: false, message: "Unauthorized" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ success: false, message: "Forbidden" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dqvzb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const itemsCollection = client.db("whereIsItDB").collection("items");
    const recoveredCollection = client
      .db("whereIsItDB")
      .collection("recoveredItems");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
         
        })
        .send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    }),
      app.post("/addItem", async (req, res) => {
        const item = req.body;
        try {
          const result = await itemsCollection.insertOne(item);
          if (result.insertedId) {
            res.send({ success: true, message: "Item added successfully!" });
          } else {
            res.send({ success: false, message: "Failed to add item." });
          }
        } catch (error) {
          res.send({ success: false, message: "An error occurred." });
        }
      });

    app.get("/allItems", async (req, res) => {
      try {
        const items = await itemsCollection.find().toArray();
        res.status(200).json(items);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch items", error });
      }
    });

    app.get("/recentItems", async (req, res) => {
      try {
        const recentItems = await itemsCollection
          .find()
          .sort({ date: -1 })
          .limit(6)
          .toArray();
        res.status(200).json(recentItems);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch recent items", error });
      }
    });

    app.get("/items/:id", verifyToken, async (req, res) => {
      const itemId = req.params.id;
      try {
        const item = await itemsCollection.findOne({
          _id: new ObjectId(itemId),
        });
        if (item) {
          res.status(200).json(item);
        } else {
          res.status(404).json({ message: "Item not found" });
        }
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch item", error });
      }
    });

    app.get("/myItems/:email", verifyToken, async (req, res) => {
      const userEmail = req.params.email;
      if (req.user.email !== userEmail) {
        return res.status(403).send({
          success: false,
          message: "You are not authorized to view this data",
        });
      }
      try {
        const myItems = await itemsCollection.find({ userEmail }).toArray();
        res.status(200).json(myItems);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch user items", error });
      }
    });

    app.put("/updateItem/:id", verifyToken, async (req, res) => {
      const itemId = req.params.id;

      if (!ObjectId.isValid(itemId)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }

      const updatedItem = req.body;
      delete updatedItem._id;

      try {
        const result = await itemsCollection.updateOne(
          { _id: new ObjectId(itemId) },
          { $set: updatedItem }
        );

        if (result.modifiedCount === 1) {
          res.status(200).json({ message: "Item updated successfully" });
        } else {
          res.status(404).json({ message: "Item not found" });
        }
      } catch (error) {
        console.error("Error updating item:", error);
        res.status(500).json({ message: "Failed to update item", error });
      }
    });

    app.delete("/deleteItem/:id", async (req, res) => {
      const itemId = req.params.id;
      try {
        const result = await itemsCollection.deleteOne({
          _id: new ObjectId(itemId),
        });
        if (result.deletedCount === 1) {
          res.status(200).json({ message: "Item deleted successfully" });
        } else {
          res.status(404).json({ message: "Item not found" });
        }
      } catch (error) {
        res.status(500).json({ message: "Failed to delete item", error });
      }
    });

    
    app.post("/recoverItem", async (req, res) => {
      const recoveryDetails = req.body;
      const { itemId } = recoveryDetails;
      try {
        const item = await itemsCollection.findOne({
          _id: new ObjectId(itemId),
        });
        if (!item || item.status === "recovered") {
          return res
            .status(400)
            .json({ message: "Item already recovered or not found" });
        }
        await recoveredCollection.insertOne(recoveryDetails);
        await itemsCollection.updateOne(
          { _id: new ObjectId(itemId) },
          { $set: { status: "recovered" } }
        );
        res
          .status(200)
          .json({ success: true, message: "Item marked as recovered" });
      } catch (error) {
        res.status(500).json({ message: "Failed to recover item", error });
      }
    });
    app.get("/itemCounts", async (req, res) => {
      try {
        const lostCount = await itemsCollection.countDocuments({ type: "lost" });
        const foundCount = await itemsCollection.countDocuments({ type: "found" });
        const recoveredCount = await recoveredCollection.countDocuments();
    
        res.status(200).json({
          lostCount,
          foundCount,
          recoveredCount,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch item counts", error });
      }
    });


    app.get("/allRecovered", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const recoveredItems = await recoveredCollection.find().toArray();
        const userRecoveredItems = recoveredItems.filter(
          (item) => item.recoveredBy.email === userEmail
        );

        res.status(200).json(userRecoveredItems);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch recovered items", error });
      }
    });

    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("WhereIsIt API is running");
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
 