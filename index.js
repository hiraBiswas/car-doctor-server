const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
  
app.use(express.json());

console.log(process.env.DB_USER)
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = "mongodb+srv://delivery_service:vJ99SbNGNQpc9cEf@cluster0.eogwfq1.mongodb.net/?retryWrites=true&w=majority";
// const uri = `mongodb+srv://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.swu9d.mongodb.net/?retryWrites=true&w=majority`;


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
   

     const userCollection = client.db("truckNow").collection("users");
     const truckCollection = client.db("truckNow").collection("truck");
     const rentCollection = client.db("truckNow").collection("rent");
     const bookedCollection = client.db("truckNow").collection("booked");
     

   // jwt related api
   app.post('/jwt', async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    res.send({ token });
  })


  // middlewares 
  const verifyToken = (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(401).send({ message: 'unauthorized access' });
    }
    const token = req.headers.authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).send({ message: 'unauthorized access' })
      }
      req.decoded = decoded;
      next();
    })
  }



const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await userCollection.findOne(query);

  // Check if user is defined and has the 'type' property
  const isAdmin = user && user.type === 'admin';

  if (!isAdmin) {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};


  // users related api
  app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    const result = await userCollection.find().toArray();
    res.send(result);
  });

  app.get('/users/admin/:email', verifyToken, async (req, res) => {
    const email = req.params.email;

    if (email !== req.decoded.email) {
      return res.status(403).send({ message: 'forbidden access' })
    }

    const query = { email: email };
    const user = await userCollection.findOne(query);
    let admin = false;
    if (user) {
      admin = user?.type === 'admin';
    }
    res.send({ admin });
  })

  app.post('/users', async (req, res) => {
    const user = req.body;
    // insert email if user doesnt exists: 
    // you can do this many ways (1. email unique, 2. upsert 3. simple checking)
    const query = { email: user.email }
    const existingUser = await userCollection.findOne(query);
    if (existingUser) {
      return res.send({ message: 'user already exists', insertedId: null })
    }
    const result = await userCollection.insertOne(user);
    res.send(result);
  });

  app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: {
        type: 'admin'
      }
    }
    const result = await userCollection.updateOne(filter, updatedDoc);
    res.send(result);
  })

  app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) }
    const result = await userCollection.deleteOne(query);
    res.send(result);
  })



  //for truck 
  app.get('/truck', async (req, res) => {
    const result = await truckCollection.find().toArray();
    res.send(result);
  });


  app.get('/truck/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) }
    const result = await truckCollection.findOne(query);
    res.send(result);
  })

  app.post('/truck', verifyToken, verifyAdmin, async (req, res) => {
    const item = req.body;
    const result = await truckCollection.insertOne(item);
    res.send(result);
  });


// ...

app.post('/rent', async (req, res) => {
  const { startDate, endDate, truckId } = req.body;

  try {
    const filter = {
      truck_id: new ObjectId(truckId),
      status: 'Approved',
      $or: [
        { startDate: { $lt: endDate }, endDate: { $gt: startDate } },
        { startDate: { $gt: startDate, $lt: endDate }, endDate: { $gt: endDate } },
      ],
    };

    // Check for existing bookings that overlap with the specified time slot
    const existingBookings = await rentCollection.find(filter).toArray();

    if (existingBookings.length > 0) {
      return res.status(409).send({
        message: 'Selected dates are not available for the chosen truck due to existing bookings.',
      });
    }

    // If no overlapping bookings, proceed with the new rental
    const item = req.body;
    const result = await rentCollection.insertOne(item);
    res.send(result);
  } catch (error) {
    console.error('Error processing rental request:', error);
    res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

// ...


  app.get('/rent', async (req, res) => {
    const { status } = req.query;
    const filter = status ? { status } : {}; 
    const result = await rentCollection.find(filter).toArray();
    res.send(result);
  });

  app.patch('/rent/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
    const rentId = req.params.id;
  
    try {
      // Find the rent request by ID
      const rentRequest = await rentCollection.findOne({ _id: new ObjectId(rentId) });
  
      if (!rentRequest) {
        return res.status(404).send({ success: false, message: 'Request not found' });
      }
  
      // Update the rent request status to 'Approved'
      await rentCollection.updateOne({ _id: new ObjectId(rentId) }, { $set: { status: 'Approved' } });
  
      // Update the rent request status to 'Approved' in the object itself
      rentRequest.status = 'Approved';
  
      // Move the approved request to the 'booked' collection
      await bookedCollection.insertOne(rentRequest);
  
      // Update the corresponding truck's bookedTimeSlots in the 'truck' collection
      await truckCollection.updateOne(
        { _id: new ObjectId(rentRequest.truckDetails._id) },
        { $push: { bookedTimeSlots: rentRequest.bookedTimeSlot } }
      );
  
      res.send({ success: true, message: 'Request approved successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).send({ success: false, message: 'Internal server error' });
    }
  });


app.patch('/rent/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;

  try {
      const filter = { _id: new ObjectId(id) };
      const update = {
          $set: {
              status: 'Rejected',
          },
      };

      const result = await rentCollection.updateOne(filter, update);

      if (result.modifiedCount > 0) {
          res.send({ success: true, message: 'Request rejected successfully' });
      } else {
          res.status(404).send({ success: false, message: 'Request not found' });
      }
  } catch (error) {
      console.error(error);
      res.status(500).send({ success: false, message: 'Internal server error' });
  }
});



app.get('/booked/:truckId', async (req, res) => {
  const truckId = req.params.truckId;

  try {
      const filter = { truck_id: truckId, status: 'Approved' };
      const bookedSlots = await rentCollection.find(filter).toArray();

      res.send(bookedSlots);
  } catch (error) {
      console.error('Error fetching booked slots:', error);
      res.status(500).send({ success: false, message: 'Internal server error' });
  }
});

app.post('/truck', verifyToken, verifyAdmin, async (req, res) => {
  const item = req.body;
  const result = await truckCollection.insertOne(item);
  res.send(result);
});

app.delete('/truck/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) }
  const result = await truckCollection.deleteOne(query);
  res.send(result);
})



app.patch('/truck/:id', async (req, res) => {
  const item = req.body;
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) }
  const updatedDoc = {
    $set: {
      name: item.name,
      category: item.category,
      rent: item.rent,
      description: item.description,
      brand: item.brand,
      capacity: item.capacity,
      fuel: item.fuel,
      img: item.img
    }
  }

  const result = await truckCollection.updateOne(filter, updatedDoc)
  res.send(result);
})
     // Send a ping to confirm a successful connection
     await client.db("admin").command({ ping: 1 });
     console.log("Pinged your deployment. You successfully connected to MongoDB!");
  

  }
  finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('TruckNow is connecting')
})

app.listen(port, () => {
  console.log(`TruckNow is sitting on port ${port}`);
})