'use strict';

require('dotenv').load();
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const https = require('https');
const fs = require('fs');
const nodeGeocoder = require('node-geocoder');
// const config = require('./config.json');
const googleOptions = {
  provider: 'google',
  httpAdapter: 'https', // Default
  apiKey: 'AIzaSyAJt6fcs83efu0Z3dm62vhlezzTfWFRJc4', // for Mapquest, OpenCage, Google Premier
  formatter: null         // 'gpx', 'string', ...
};

const geocoder = nodeGeocoder(googleOptions);

const sslOptions = {
  key: fs.readFileSync(process.env.KEY),
  cert: fs.readFileSync(process.env.CERT)
};

const app = express().use(bodyParser.json());
// Sets server port and logs message on success
https.createServer(sslOptions, app).listen(process.env.PORT || 1337, () => {
// app.listen(process.env.PORT || 1337, () => {
    console.log('webhook listening....');
    
});

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// Creates the endpoint for our webhook 
app.post('/webhook', (req, res) => {
 
    let body = req.body;

    // Checks this is an event from a page subscription
    if (body.object === 'page') {
  
      // Iterates over each entry - there may be multiple if batched
      body.entry.forEach((entry) => {
        // Gets the message. entry.messaging is an array, but 
        // will only ever contain one message, so we get index 0
        let webhook_event = entry.messaging[0];
        console.log(webhook_event);

        // Get the sender PSID
        let sender_psid = webhook_event.sender.id;
        console.log('Sender PSID: ' + sender_psid);

        // Check if the event is a message or postback and
        // pass the event to the appropriate handler function
        if (webhook_event.message) {
          handleMessage(sender_psid, webhook_event.message);
        } else if (webhook_event.postback) {
          handlePostback(sender_psid, webhook_event.postback);
        }
      });
  
      // Returns a '200 OK' response to all requests
      res.status(200).send('EVENT_RECEIVED');
    } else {
      // Returns a '404 Not Found' if event is not from a page subscription
      res.sendStatus(404);
    }
  
});

// Adds support for GET requests to our webhook
app.get('/webhook', (req, res) => {

    // Your verify token. Should be a random string.
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
      
    // Parse the query params
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
      
    // Checks if a token and mode is in the query string of the request
    if (mode && token) {
    
      // Checks the mode and token sent is correct
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        
        // Responds with the challenge token from the request
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
      
      } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        res.sendStatus(403);      
      }
    }
  });

const handleMessage = async (sender_psid, received_message) => {

    const response = await buildResponse(received_message);

    await callSendAPI(sender_psid, response);    
}

// Handles messaging_postbacks events
const handlePostback = async (sender_psid, received_postback) => {
    let response;
    
    // Get the payload for the postback
    const payload = received_postback.payload;

    // Set the response based on the postback payload
    if (payload === 'yes') {
        response = { "text": "Thanks!" }
    } else if (payload === 'no') {
        response = { "text": "Oops, try sending another image." }
    }
    await callSendAPI(sender_psid, response);
}

const callSendAPI = async (sender_psid, response) => {
    let request_body = await {
        "recipient": {
        "id": sender_psid
        },
        "message": response
    };

    await request({
        "url": "https://graph.facebook.com/v2.6/me/messages",
        "qs": { "access_token": PAGE_ACCESS_TOKEN },
        "method": "POST",
        "json": request_body
    }, (err, res, body) => {
        if (!err) {
            console.log('message sent!')
        } else {
            console.error("Unable to send message:" + err);
        }
    });
    console.log(request_body);
}

const getAddressByCoordinates = async (coordinates) => {
    try {
        const results = await geocoder.geocode(`${coordinates.lat}, ${coordinates.long}`);
        return results.map(result => result.formattedAddress);;
    } catch(err){
        console.error(err) 
    }
}

const buildResponse = async (request) => {
    let response;

    console.log(request);
    if (request.quick_reply) {
        switch (request.quick_reply.payload) {
            case "REQUEST_RIDE":
                if (request.text == "Yes") {
                    response = {
                        "text": `Please share your location:`,
                        "quick_replies":[{
                            "content_type":"location"
                        }]
                    };
                } else if (request.text == "No") {
                    response = {
                            "attachment":{
                                "type":"template",
                                "payload":{
                                    "template_type":"button",
                                    "text":"What do you want to do next?",
                                    "buttons":[{
                                        "type":"web_url",
                                        "url":"http://www.teksi.co.za",
                                        "title":"Visit our site"
                                    },
                                    {
                                        "type":"phone_number",
                                        "title":"Call Us",
                                        "payload":"+15105551234"
                                    }]
                                }
                            }
                     };
                }
                break;
        
            default:
                break;
        }
    } else if (request.text) {
        response = await {
            "text": `Hello, would you like a ride?`,
            "quick_replies":[{
                "content_type":"text",
                "title":"Yes",
                "payload": "REQUEST_RIDE"
            },
            {
                "content_type":"text",
                "title":"No",
                "payload": "REQUEST_RIDE"
            }]
        };

    } else if (request.attachments) {
        if(request.attachments[0].payload.coordinates){
            const results = await getAddressByCoordinates(request.attachments[0].payload.coordinates);
            console.log(results);
            let title = `Sorry, I can't get you street address from the shared location, Please type in your Street Address`;
            let buttons = [];
            if(results.length == 1){
                title = `Is this the correct address?`;
                buttons = [
                    {
                    "type": "postback",
                    "title": "Yes!",
                    "payload": {"street_address_correct": true},
                    },
                    {
                    "type": "postback",
                    "title": "No!",
                    "payload": {"street_address_correct": false},
                    }
                ];
            }
        }
    }
    return response;
}


//   /*
//   if (received_message.attachments) {
//         response = {
//             "attachment": {
//                 "type": "template",
//                 "payload": {"template_type": "generic"}
//             }
//         };

//       if (results.length > 1) {
//           results.forEach(element => {
//           title = `Please select the correct address below :`;
//             buttons.push(
//               {
//               "type": "postback",
//               "title": `${element}`,
//               "payload": {"street_address": element},
//               });
//           });
//         }
//         response.elements = {"title": title, "buttons": buttons};
//       } else if(received_message.attachments[0].payload.need_ride) {
//         let need_ride = received_message.attachments[0].payload.need_ride;
//         if (need_ride == "yes") {
//             response = null;
//             response = {
//                 "text": `Please share your location:`,
//                 "quick_replies":[{
//                     "content_type":"location"
//                 }]
//             };
//         } else {

//         }
//     }
//     }
