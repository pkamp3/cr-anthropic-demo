# Voice Assistant with Twilio and Anthropic (Node.js)

> [!NOTE] This branch adds local conversation tracking and more robust interruption handling to our Anthropic demo. This will let us inform the LLM how far a response was read to the user before the user interrupted, avoiding confusion down the line.

This application demonstrates how to use Node.js, [Twilio Voice](https://www.twilio.com/docs/voice) and [ConversationRelay](), and the [Anthropic API](https://docs.anthropic.com) to create a voice assistant that can engage in two-way conversations over a phone call. Other branches in this repository demonstrate how to add more advanced features such as streaming, interruption handling, and tool/function calling.

## Prerequisites

To use the app, you will need:

- **Node.js 23.9.0**: Download from [here](https://nodejs.org/). Other versions may work, but I tested with this one.
- **A Twilio Account**: Sign up for a free trial [here](https://www.twilio.com/try-twilio).
- **A Twilio Number with Voice Capabilities**: [Instructions to purchase a number](https://support.twilio.com/hc/en-us/articles/223180928-How-to-Buy-a-Twilio-Phone-Number).
- **An Anthropic Account and API Key**: Visit Anthropic's documentation [here](https://docs.anthropic.com/en/api/admin-api/apikeys/get-api-key) for more information.

## Setup

### 1. Run ngrok

You'll need to expose your local server to the internet for Twilio to access it. Use ngrok for tunneling:

```bash
ngrok http 8080
```

Copy the Forwarding URL and put it aside; it looks like https://[your-ngrok-subdomain].ngrok.app. You'll need it in a couple places.

### 2. Install dependencies

Run the following command to install necessary packages:

```bash
npm install
```

### 3. Configure Twilio

Update Your Twilio Phone Number: In the Twilio Console under **Phone Numbers**, set the Webhook for **A call comes in** to your ngrok URL followed by /twiml. 

Example: `https://[your-ngrok-subdomain].ngrok.app/twiml`.

### 4. Configure Environment Variables

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Edit the .env file and input your Anthropic API key in `ANTHROPIC_API_KEY`. Add your ngrok URL in `NGROK_URL` (do not include the scheme, "http://" or "https://")

## Run the app

Start the development server:

```bash
node index.js
```

## Run and test the app

Call your Twilio phone number. After connection, you should be able to converse with the Anthropic-powered AI Assistant, integrated over ConversationRelay with Twilio Voice!

> [!NOTE] 
> Customize the initial greeting and response behavior by modifying the aiResponse function and constants like SYSTEM_PROMPT in index.js.
> Ensure that you update ngrok URLs each time you restart ngrok, as they change with each session.