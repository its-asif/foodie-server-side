const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


const { ObjectId, MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.gf8ipgr.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("fooDie").collection("users");
    const menuCollection = client.db("fooDie").collection("menu");
    const reviewCollection = client.db("fooDie").collection("reviews");
    const cartCollection = client.db("fooDie").collection("cart");
    const paymentCollection = client.db("fooDie").collection("payments");

    // JWT related api
    app.post('/jwt', async(req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '6h'});
      res.send({token});
    });


    // verify token
    const verifyToken = (req, res, next) => {
      console.log("inside verify token",req.headers.authorization);
      if(!req.headers.authorization) {
        return res.status(401).send({ message : 'Unauthorized request'});
      }

      const token = req.headers.authorization.split(' ')[1];


      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if(err) {
          return res.status(401).send({ message : 'Unauthorized request'});
        }
        req.decoded = decoded;
        next();
      })
    }


    // use verify admin after verify token
    const verifyAdmin = async(req, res, next) => {
      const email = req.decoded.email;
      const query = {email: email};
      const user = await userCollection.findOne(query);
      let isAdmin = user?.role === 'admin';

      if(!isAdmin) {
        return res.status(403).send({ message : 'Unauthorized access'});
      }
      next();
    }


    // user related api
    app.get('/users', verifyToken, verifyAdmin, async(req, res) => {
        const result = await userCollection.find().toArray();
        res.send(result);
    })

    app.get('/users/admin/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      if(email !== req.decoded.email) {
        return res.status(403).send({ message : 'Unauthorized access'});
      }

      const query = {email: email};
      const user = await userCollection.findOne(query);
      let isAdmin = false;
      if(user){
        isAdmin = user?.role === 'admin';
      }
      res.send({isAdmin : isAdmin});
    })

    app.post('/users', async(req, res) => {
        const newUser = req.body;
        
        const query = {email: newUser.email};
        const existingUser = await userCollection.findOne(query);
        if(existingUser) {
            return res.send({message: 'User already exists', insertedId: null});
        }

        const result = await userCollection.insertOne(newUser);
        res.send(result);
    })

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async(req, res) => { 
        const id = req.params.id;
        const filter = {_id: new ObjectId(id)};
        const updateDoc = {
            $set: {
                role : 'admin',
            }
        }; 
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
    })

    app.delete('/users/:id', verifyToken, verifyAdmin, async(req, res) => {
        const id = req.params.id;
        const query = {_id: new ObjectId(id)};
        const result = await userCollection.deleteOne(query);
        res.send(result);
    })



    // menu related api
    app.get('/menu', async(req, res) => {
        const result = await menuCollection.find().toArray();
        res.send(result);
    })

    app.get('/menu/:id', async(req, res) => {
        const id = req.params.id;
        const query = {_id: new ObjectId(id)};
        let result = await menuCollection.findOne(query);
        if(!result) {
          const query = {_id: id};
          result = await menuCollection.findOne(query);
        }
        res.send(result);
    });

    app.post('/menu', verifyToken, verifyAdmin, async(req, res) => {
        const newMenuItem = req.body;
        const result = await menuCollection.insertOne(newMenuItem);
        res.send(result);
    });

    app.patch('/menu/:id', verifyToken, verifyAdmin, async(req, res) => {
      const item = req.body;
        const id = req.params.id;
        const filter = {_id: new ObjectId(id)};
        const updateDoc = {
            $set: {
                name : item.name,
                category : item.category,
                price : item.price,
                recipe : item.recipe,
                image : item.image,
            }
        }; 
        let result = await menuCollection.updateOne(filter, updateDoc);
        if(result.modifiedCount === 0) {
          const query = {_id: id};
          result = await menuCollection.updateOne(query, updateDoc);
        }
        res.send(result);
    });

    app.delete('/menu/:id', verifyToken, verifyAdmin, async(req, res) => {
        const id = req.params.id;
        let query = {_id: new ObjectId(id)};
        let result = await menuCollection.deleteOne(query);
        if(result.deletedCount === 0) {
          query = {_id: id};
          result = await menuCollection.deleteOne(query);
        }
        console.log(result);
        res.send(result);
    });



    // review related api
    app.get('/reviews', async(req, res) => {
        const result = await reviewCollection.find().toArray();
        res.send(result);
    })

    // cart collection
    app.get('/carts', async(req, res) => {
      const email = req.query.email;
      const query = {email: email};
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/carts', async(req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete('/carts/:id', async(req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });


    // Payment intent
    app.post('/create-payment-intent', async(req, res) => {
      const {price} = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],  
      });
      
      


      // set paymentCollection status delivered
      const query = {email: req.body.email};
      const updateDoc = {
        $set: {
          status : 'delivered',
        }
      };

      const result = await cartCollection.updateMany(query, updateDoc);
      console.log(result);
      
      res.send({
        clientSecret: paymentIntent.client_secret,
        
      })

    }); 

    app.get('/payments/:email', verifyToken, async(req, res) => {
      const query = {email: req.params.email};
      if(req.decoded.email !== req.params.email) {
        return res.status(403).send({ message : 'Unauthorized access'});
      }
      const result = await paymentCollection.find(query).toArray();
      console.log(result);
      res.send(result); 
    });

    app.post('/payments', verifyToken ,  async(req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);


      const query = {_id : {
        $in : payment.cartIds.map(id => new ObjectId(id))
      }};
      const deleteResult = await cartCollection.deleteMany(query);
      // console.log(payment);

      res.send({result, deleteResult});
    })


    // stats or analytics
    app.get('/admin-stats', verifyToken , async(req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // this is not the best way
      // const payments = await paymentCollection.find().toArray();
      // const totalRevenue = payments.reduce((total, payment) => total + payment.amount, 0);

      const result = await paymentCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$price" }
          }
        }
      ]).toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

      res.send({users, menuItems, orders, revenue})
    });

    // Order Status

 

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('foodie is running!');
}); 

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});