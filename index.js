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
        handleEntry(entry);
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
    if (payload === 'first hand shake') {
        response = { "text": "Hi there!" }
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
    console.log(JSON.stringify(request_body));
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
                        "text": `How many are you?`,
                        "quick_replies":[{
                            "content_type":"text",
                            "title":"1-2",
                            "payload": "PASSENGERS"
                        },
                        {
                            "content_type":"text",
                            "title":"3-5",
                            "payload": "PASSENGERS"
                        },
                        {
                            "content_type":"text",
                            "title":"6-7",
                            "payload": "PASSENGERS"
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
                case "PASSENGERS":
                    response = {
                        "text": `Please share your location:`,
                        "quick_replies":[{
                            "content_type":"location"
                        }]
                    };
                break;
        
            default:
                break;
        }
    } else if (request.text) {
        response = {
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
            if(results.length == 1){
                response = {
                    "text": `Is this the correct address : ${results[0]}`,
                    "quick_replies":[{
                            "content_type":"text",
                            "title": "Yes",
                            "payload": "CONFIRM_ADDRESS",
                        },
                        {
                            "content_type":"text",
                            "title": "No",
                            "payload": "CONFIRM_ADDRESS",
                        }]
                };
            } else if (results.length > 1) {
                response = {
                    "text": `Please select the correct address below :`,
                };
                results.forEach(element => {
                    response.quick_replies.push(
                        {
                            "content_type":"text",
                            "title": `${element}`,
                            "payload": "SELECT_ADDRESS",
                        });
                });
            } else if (false) {
                response = {
                    "text": `Sorry, I can't get you street address from the shared location, Please type in your Street Address`,
                    "quick_replies":[{
                        "content_type":"text",
                        "title": "Yes",
                        "payload": "TYPE_ADDRESS",
                    }]
                };
            }
        }
    }
    return response;
}
const sendAction = async (userId, action) => {
    let response = { 
        "recipient": {
        "id": userId
        },
        "sender_action": action
    };
    await request({
        "url": "https://graph.facebook.com/v2.6/me/messages",
        "qs": { "access_token": PAGE_ACCESS_TOKEN },
        "method": "POST",
        "json": response
    }, (err, res, body) => {
        if (!err) {
            console.log('action sent!')
        } else {
            console.error("Unable to send action:" + err);
        }
    });
}


const handleEntry = async (entry) => {
    let webhook_event = entry.messaging[0];
    console.log(webhook_event);

    let sender_psid = webhook_event.sender.id;
    console.log('Sender PSID: ' + sender_psid);
    await sendAction(sender_psid, "mark_seen");
    await sendAction(sender_psid, "typing_on");

    if (webhook_event.message) {
        await handleMessage(sender_psid, webhook_event.message);
    } else if (webhook_event.postback) {
        await handlePostback(sender_psid, webhook_event.postback);
    }
    await sendAction(sender_psid, "typing_off");
}

