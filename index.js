require("dotenv").config()
const express = require("express")
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY); // Replace with your Stripe secret key
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000
const cors = require("cors")


app.use(cors())
app.use(express.json())

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

        app.get("/parcels", async (req, res) => {
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

                res.send({insertResult, updateResult,
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