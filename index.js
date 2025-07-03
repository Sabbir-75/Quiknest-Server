require("dotenv").config()
const express = require("express")
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY); // Replace with your Stripe secret key
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const app = express()
const port = process.env.PORT || 5000
const cors = require("cors")


app.use(cors())
app.use(express.json())


{/*-------------- For Verify Token and Email By Firebase accessToken and passed email  --------------*/ }

// Firebase Admin 
const decoded = Buffer.from(process.env.FIREBASE_ADMIN_KEY, "base64").toString("utf8")
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Firebase acessToken verify and store in decoded

const firebaseVerifyToken = async (req, res, next) => {
    const headers = req.headers.authorization
    if (!headers) {
        return res.status(401).send({ message: "Unauthorization Access for headers" })
    }
    const token = headers.split(" ")[1]
    if (!token) {
        return res.status(401).send({ message: "Unauthorization Access for token" })
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.decoded = decoded
        next()
    }
    catch (error) {
        return res.status(403).send({ message: "Forbidden Access allover headers and token" })
    }

}

// Firebase verify By email

const verifyEmail = (req, res, next) => {
    if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access for email" })
    }
    next()
}


app.get("/", (req, res) => {
    res.send("Quiknest Database is running")
})

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@inventorycluster.dks3jbe.mongodb.net/?retryWrites=true&w=majority&appName=inventoryCluster`;


const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const parcelsCollections = client.db("parcelsCode").collection("parcels")

        app.post("/parcels", async (req, res) => {
            const find = req.body
            const result = await parcelsCollections.insertOne(find)
            res.send(result)
        })

        //user All parcels by Newest first || filtered by email

        app.get("/parcels", firebaseVerifyToken, verifyEmail, async (req, res) => {
            const userEmail = req.query.email
            const query = userEmail ? { created_by: userEmail } : {}
            const options = {
                sort: { creation_date: -1 }, // Newest first
            }
            const result = await parcelsCollections.find(query, options).toArray()
            res.send(result)
        })

        // get single data 

        app.get("/parcels/:id", async (req, res) => {
            const id = req.params.id
            const find = { _id: new ObjectId(id) }
            const result = await parcelsCollections.findOne(find)
            res.send(result)
        })

        //delete item

        app.delete("/parcels/:id", async (req, res) => {
            const id = req.params.id
            const find = { _id: new ObjectId(id) }
            const result = await parcelsCollections.deleteOne(find)
            res.send(result)
        })



        // Payment System Integration

        app.post('/create-payment-intent', async (req, res) => {
            const body = req.body
            const amountInCents = body.amountInCents

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });


                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        const paymentsCollections = client.db("parcelsCode").collection("payments")


        // Payment data post and update this payment_status

        app.post('/payments', async (req, res) => {
            const { transactionId, paymentMethod, amount, customerEmail, parcelId } = req.body;

            try {

                // ১) payment_records কালেকশনে নতুন রেকর্ড insert/post করো
                const paymentRecord = {
                    parcelId,
                    transactionId,
                    paymentMethod,
                    amount,
                    customerEmail,
                    created_At_string: new Date().toISOString(),
                    created_At: new Date()
                };
                const insertResult = await paymentsCollections.insertOne(paymentRecord);

                // ২) parcels/অর্ডারে payment_status আপডেট করো

                const find = { _id: new ObjectId(parcelId) }
                const updatedDoc = {
                    $set: {
                        payment_status: "paid"
                    }
                }

                const updateResult = await parcelsCollections.updateOne(find, updatedDoc);

                res.send({
                    insertResult, updateResult,
                    success: true,
                    paymentRecordId: insertResult.insertedId,
                    updatedCount: updateResult.modifiedCount,
                    message: 'Payment recorded and order updated successfully'
                });
            } catch (error) {
                console.error('Payment update failed:', error);
                res.status(500).send({ success: false, error: error.message });
            }
        });

        app.get('/payments', firebaseVerifyToken, verifyEmail, async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.customerEmail = email
            }
            const newest = {
                sort: { created_At: -1 }
            }
            const result = await paymentsCollections.find(query, newest).toArray()
            res.send(result)
        })


        // for users Authenticate by Once in firebase
        const usersCollections = client.db("parcelsCode").collection("users")

        app.post("/users", async (req, res) => {
            const data = req.body
            const email = req.body.email
            const query = { email: email }
            const findResult = await usersCollections.findOne(query)
            if (findResult) {
                const query = req.body.email
                const find = { email: query }
                const updatedLastTime = {
                    $set: {
                        last_login: new Date().toISOString()
                    }
                }
                const result = await usersCollections.updateOne(find, updatedLastTime)
                res.send(result)
                return res.status(200).send({ message: "user already exists", inserted: false })
            }

            const result = await usersCollections.insertOne(data)
            res.send(result)
        })

        // role waise checking

        app.get("/users/search/:email", async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ error: "Email query is required" });
                }

                const user = await usersCollections.findOne({ email });

                if (!user) {
                    return res.status(404).send({ error: "User not found" });
                }

                // Default role = "user" if not set
                const role = user.role || "user";

                res.status(200).send({
                    email: user.email,
                    role: role,
                });
            }
            catch (error) {
                console.error("❌ Error searching user:", error.message);
                res.status(500).json({ error: "Internal server error" });
            }
        });

        // Firebase verify By Admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email }
            const user = await usersCollections.findOne(query)
            console.log(user);

            if (!user || user.role !== "admin") {
                return res.status(403).send({ message: "forbidden access for Admin" })
            }

            next()
        }


        app.get('/users/search', firebaseVerifyToken, async (req, res) => {
            const email = req.query.email;
            const result = await usersCollections.findOne({ email });
            res.send(result);
        });
        app.patch('/users/makeAdmin/:email', firebaseVerifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollections.updateOne(
                { email: req.params.email },
                { $set: { role: "admin" } }
            );
            res.send(result);
        });

        app.patch('/users/renoveAdmin/:email', firebaseVerifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollections.updateOne(
                { email: req.params.email },
                { $set: { role: "user" } }
            );
            res.send(result);
        });


        //Be a Riders Collection

        const ridersCollections = client.db("parcelsCode").collection("riders")

        app.post("/riders", async (req, res) => {
            const riders = req.body
            const result = await ridersCollections.insertOne(riders)
            res.send(result)
        })

        app.get("/riders/assign", async (req, res) => {
            const { payment_status, delivery_status } = req.query
            console.log(payment_status, delivery_status);
            if (payment_status && delivery_status) {
                const query = {
                    payment_status: payment_status || "paid",
                    delivery_status: delivery_status || "pending"
                }
                result = await parcelsCollections.find(query).toArray()
                res.send(result)
            }
        })


        app.get("/riders/dist/:district", async (req, res) => {
            const district = req.params.district
            const query = {
                warehouse: district,
                rider_status: "active"
            }
            const result = await ridersCollections.find(query).toArray()
            res.send(result)
        })


        app.get("/riders", async (req, res) => {
            const result = await ridersCollections.find().toArray()
            res.send(result)
        })

        app.get("/pending/riders", firebaseVerifyToken, verifyAdmin, async (req, res) => {
            const query = { rider_status: "pending" }
            const result = await ridersCollections.find(query).toArray()
            res.send(result)
        })

        app.patch("/riders/status/:id", async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const data = req.body.rider_status
            const feedback = req.body.feedback

            if (!feedback) {
                const updatedStatus = {
                    $set: {
                        rider_status: data
                    }
                }
                const result = await ridersCollections.updateOne(query, updatedStatus)
                res.send(result)
            }
            else {
                const updatedStatuswithFeedback = {
                    $set: {
                        rider_status: data,
                        feedback: feedback
                    }
                }
                const result = await ridersCollections.updateOne(query, updatedStatuswithFeedback)
                res.send(result)
            }

            const email = req.body.email
            const queryEmail = { email: email }
            const updatedDoc = {
                $set: {
                    rolle: "rider"
                }
            }
            const result = await usersCollections.updateOne(queryEmail, updatedDoc)
            res.send(result)

        })

        app.get("/active/riders", firebaseVerifyToken, verifyAdmin, async (req, res) => {
            const { search, typing } = req.query
            const query = {}
            // if (search) {
            //     query.contact = { $regex: search, $options: "i" }; // Case-insensitive partial match
            // }
            // if(!search){
            //     query.rider_status = "active"
            // }
            if (search) {
                query.contact = search
            }
            if (typing) {
                query.contact = { $regex: typing, $options: "i" }
            }
            query.rider_status = "active"
            const result = await ridersCollections.find(query).toArray()
            res.send(result)
        })

        app.patch("/riders/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName, riderContact, riderEmail } = req.body;

            const updateDoc = {
                $set: {
                    riderId: new ObjectId(riderId),
                    riderName,
                    riderContact,
                    riderEmail,
                    delivery_status: "assigned",
                    assignedAt: new Date(),
                    assignment_log: {
                        assignedBy: "admin",
                        assignedAt: new Date()
                    }
                }
            };

            const result = await parcelsCollections.updateOne(
                { _id: new ObjectId(parcelId) },
                updateDoc
            );

            // Optional: update rider status
            updateResult = await ridersCollections.updateOne(
                { _id: new ObjectId(riderId) },
                {
                    $set: {
                        rider_status: "assigned",
                        currentParcelId: parcelId
                    },
                    $inc: {
                        assignedParcelsCount: 1
                    }
                }
            );

            res.send({result,updateResult});
        });





        {/*-------------- For Ping and if we want to output in the bash or terminal --------------*/ }
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    finally {

    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`Quiknest Database is running on ${port}`);
})