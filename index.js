
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.PAYMENT_GETWAY_SECRET);
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "https://tabletalk-restaurant-edf5e.web.app",
    "https://sheam-cf895.web.app",
    "https://sheam-cf895.firebaseapp.com",
    "https://restaurant-management-server-dusky.vercel.app",
    "https://restaurant-management-65c50.web.app"
  ],
  credentials: true,
  optionSuccessStatus: 200,
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

// middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const verifyToken = (req, res, next) => {
  // Support both cookie-based and Authorization header-based tokens
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized access!");
  } else {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).send("Unauthorized access!");
      }
      req.user = decoded;
      next();
    });
  }
};

const verifyUserEmail = (req, res, next) => {
  const email = req.user?.email;
  if (!email) {
    return res.status(403).send("Forbidden access!");
  }
  req.verifiedEmail = email;
  next();
};

// sending mail using nodemailer
const sendEmail = async (emailAddress, emailData) => {
  // Create a transporter using SMTP
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  transporter.verify(function (error, success) {
    if (error) {
      console.log("error inside verify", error);
    } else {
      console.log("Server is ready to take our message!");
    }
  });

  const mailBody = {
    from: `"TableTalk" <${process.env.SMTP_USER}>`, // sender address
    to: emailAddress,
    subject: emailData.subject,
    html: emailData.message,
  };

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email send: " + info.response);
    }
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gusrp.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const menuCollections = client.db("tableTalkDb").collection("menuItems");
    const cartCollections = client.db("tableTalkDb").collection("cartItems");
    const userCollections = client.db("tableTalkDb").collection("userItems");
    const reservationCollections = client
      .db("tableTalkDb")
      .collection("reserveItems");
    const paymentCollections = client.db("tableTalkDb").collection("payments");
    const reviewCollections = client.db("tableTalkDb").collection("reviews");

    // token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      console.log("user and token --> ", token, user);

      
      res.cookie("token", token, cookieOptions).send({ success: true, token });
    });
    app.get("/logout", (req, res) => {
      res
        .clearCookie("token", { ...cookieOptions, maxAge: 0 })
        .send({ success: true });
    });

    // middleware
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.verifiedEmail;
        const user = await userCollections.findOne({ email });

        if (!user || user.role !== "admin") {
          return res.status(403).send("Forbidden: admin access only");
        }
        next();
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    };

    // getting all menu items
    app.get("/all-menu", async (req, res) => {
      const result = await menuCollections.find().toArray();
      res.send(result);
    });

    // getting menu items by category
    app.get("/menu", async (req, res) => {
      const category = req.query.category;
      const query = category ? { category } : {};
      const result = await menuCollections.find(query).toArray();
      res.send(result);
    });
    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await menuCollections.findOne(filter);
      res.send(result);
    });
    app.patch(
      "/menu/:id",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;
        try {
          const filter = { _id: new ObjectId(id) };
          const updateDoc = { $set: updateData };
          const result = await menuCollections.updateOne(filter, updateDoc);
          res.send(result); // result.modifiedCount will tell if update was successful
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.post(
      "/menu",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        try {
          const menuItem = req.body;
          const result = await menuCollections.insertOne(menuItem);
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );
    app.delete(
      "/menu/:id",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await menuCollections.deleteOne(query);
        res.send(result);
      },
    );

    // reviews API
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewCollections.find().toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    app.post("/reviews", verifyToken, async (req, res) => {
      try {
        const { name, details, rating } = req.body;

        if (!name || !details || !rating) {
          return res.status(400).send({ message: "All fields are required" });
        }

        const review = {
          name,
          details,
          rating: Number(rating),
          createdAt: new Date(),
        };

        const result = await reviewCollections.insertOne(review);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add review" });
      }
    });

    // fetching specific user cart
    app.get("/cart", verifyToken, async (req, res) => {
      try {
        const email = req.user?.email;
        const query = { email };
        if (!email) {
          return res.status(403).send("forbidden access");
        }
        const cartItems = await cartCollections.find(query).toArray();
        res.send(cartItems);
      } catch (error) {
        // console.error(error);
        res.status(500).send({ error: "Failed to fetch cart items" });
      }
    });
    app.post("/cart", verifyToken, async (req, res) => {
      const item = req.body;
      const result = await cartCollections.insertOne(item);
      res.send(result);
    });
    app.delete("/cart/:id", verifyToken, verifyUserEmail, async (req, res) => {
      const id = req.params.id;
      // console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await cartCollections.deleteOne(query);
      res.send(result);
    });

    // --------------------payment related api--------------
    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get(
      "/payment-history",
      verifyToken,
      verifyUserEmail,
      async (req, res) => {
        try {
          const email = req.verifiedEmail;
          const query = { email };
          const result = await paymentCollections.find(query).toArray();
          // console.log(result);
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.post("/payments", verifyToken, verifyUserEmail, async (req, res) => {
      try {
        const {
          email,
          transactionId,
          type,
          cartIds = [],
          reservationIds = [],
          amount,
          status,
          date,
        } = req.body;
        // console.log(req.body);
        if (!email || !transactionId || !type) {
          return res.status(400).send({
            success: false,
            message: "Invalid payment data",
          });
        }
        const paymentInfo = {
          email,
          transactionId,
          type,
          cartIds,
          reservationIds,
          amount,
          status,
          date,
        };
        const paymentResult = await paymentCollections.insertOne(paymentInfo);

        let deletedCartResult = null;
        let updatedReservationResult = null;

        // delete cart after payments
        if (type === "cart" && cartIds.length > 0) {
          const query = {
            _id: {
              $in: paymentInfo.cartIds.map((id) => new ObjectId(id)),
            },
          };
          deletedCartResult = await cartCollections.deleteMany(query);
        }

        // update reservation payment status after payments
        if (type === "reservation" && reservationIds.length > 0) {
          const query = {
            _id: { $in: reservationIds.map((id) => new ObjectId(id)) },
          };
          updatedReservationResult = await reservationCollections.updateMany(
            query,
            {
              $set: { paymentStatus: "paid" },
            },
          );
        }

        // Send email after payment success
        const emailData = {
          subject: `Payment Confirmation - ${type.toUpperCase()}`,
          message: `
                        <h2>Payment Successful!</h2>
                        <p>Hi ${email},</p>
                        <p>Thank you for your payment at TableTalk Restaurant.</p>
                        <ul>
                            <li>Transaction ID: <strong>${transactionId}</strong></li>
                            <li>Payment Type: <strong>${type}</strong></li>
                            <li>Amount Paid: <strong>$${amount}</strong></li>
                            <li>Date: <strong>${new Date(date).toLocaleString()}</strong></li>
                        </ul>
                        <p>We appreciate your visit!</p>
                    `,
        };

        await sendEmail(email, emailData);

        res.send({
          paymentResult,
          deletedCartResult,
          updatedReservationResult,
          emailSent: true,
        });
      } catch (err) {
        res.status(500).send({ error: err.message, success: false });
      }
    });

    // table reservation
    app.get("/dashboard/reservations", async (req, res) => {
      try {
        const result = await reservationCollections.find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get(
      "/dashboard/reservation",
      verifyToken,
      verifyUserEmail,
      async (req, res) => {
        try {
          const email = req.verifiedEmail;
          const query = { userEmail: email };
          const result = await reservationCollections.find(query).toArray();
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.post("/dashboard/reservation", verifyToken, async (req, res) => {
      try {
        const reserve_details = req.body;
        const email = req.user?.email;
        if (email) {
          reserve_details.activity = "Pending";
          reserve_details.userEmail = email;
          const result =
            await reservationCollections.insertOne(reserve_details);
          res.send(result);
        } else {
          res.status(403).send("forbidden access!");
        }
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.patch("/admin/reservation/:id", async (req, res) => {
      const u_id = req.params.id;
      const filter = { _id: new ObjectId(u_id) };
      const updatedDoc = {
        $set: {
          activity: "Done",
        },
      };
      try {
        const result = await reservationCollections.updateOne(
          filter,
          updatedDoc,
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.delete(
      "/dashboard/reservation/:id",
      verifyToken,
      verifyUserEmail,
      async (req, res) => {
        try {
          const u_id = req.params.id;
          const query = { _id: new ObjectId(u_id) };
          const result = await reservationCollections.deleteOne(query);
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    // users related apis
    app.get(
      "/admin/users/:email",
      verifyToken,
      verifyUserEmail,
      async (req, res) => {
        const email = req.params.email;
        const user = await userCollections.findOne({ email });
        let isAdmin = false;
        isAdmin = user?.role === "admin";
        res.send({ isAdmin });
      },
    );

    app.get(
      "/admin-statistics",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        try {
          const users = await userCollections.estimatedDocumentCount();
          const orders = await cartCollections.estimatedDocumentCount();

          const result = await paymentCollections
            .aggregate([
              {
                $group: {
                  _id: null,
                  totalRevenue: {
                    $sum: "$amount",
                  },
                },
              },
            ])
            .toArray();

          const revenue = result.length > 0 ? result[0].totalRevenue : 0;

          res.send({
            users,
            orders,
            revenue,
          });
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.get(
      "/admin/users",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await userCollections.find().toArray();
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      const isExistUser = await userCollections.findOne(query);

      if (isExistUser) {
        return res.send({ message: "user already exists" });
      } else {
        const result = await userCollections.insertOne(user);
        res.send(result);
      }
    });

    app.patch(
      "/users/:id",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        const u_id = req.params.id;
        const query = { _id: new ObjectId(u_id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        try {
          const result = await userCollections.updateOne(query, updatedDoc);
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    app.delete(
      "/users/:id",
      verifyToken,
      verifyUserEmail,
      verifyAdmin,
      async (req, res) => {
        try {
          const u_id = req.params.id;
          const query = { _id: new ObjectId(u_id) };
          const result = await userCollections.deleteOne(query);
          res.send(result);
        } catch (err) {
          res.status(500).send({ error: err.message });
        }
      },
    );

    // console.log("MongoDB connected!");
  } catch (err) {
    console.error("Error from Server --> ", err);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running!");
});

app.listen(port, () => {
  console.log("server is running on:", port);
});
