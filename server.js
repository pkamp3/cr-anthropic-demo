import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import axios from "axios";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING = "Hi! I am a voice assistant powered by Twilio and Anthropic. Ask me anything!";
const SYSTEM_PROMPT = `You are a helpful assistant. This conversation is being translated to voice, so answer carefully. 
When you respond, please spell out all numbers, for example, twenty not 20. Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.
You should use the 'get_programming_joke' function only when the user is asking for a programming joke (or a very close prompt, such as developer or software engineering joke). 
For other requests, including other types of jokes, you should use your own knowledge.`;

const sessions = new Map();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getJoke() {
  const response = await axios.get("https://v2.jokeapi.dev/joke/Programming?safe-mode");
  const data = response.data;
  return data.type === "single" ? data.joke : `${data.setup} ... ${data.delivery}`;
}

async function aiResponseStream(conversation, ws) {
  const tools = [
    {
      name: "get_programming_joke",
      description: "Fetches a programming joke",
      input_schema: {
        type: "object",
        properties: {},
        required: []
      }
    }
  ];

  const stream = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: conversation,
    system: SYSTEM_PROMPT,
    tools: tools,
    stream: true,
  });

  const assistantSegments = [];
  console.log("Received response chunks:");

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const content = chunk.delta.text;

      console.log("Chunk:", content);
      ws.send(JSON.stringify({
        type: "text",
        token: content,
        last: false,
      }));
      assistantSegments.push(content);
    }

    // Check for tool use blocks
    if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
      const toolCall = chunk.content_block;
      if (toolCall.name === "get_programming_joke") {
        const joke = await getJoke();

        // Push tool use block
        conversation.push({
          role: "assistant",
          content: [{
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input
          }]
        });

        // Push tool result as the next user message
        conversation.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: joke
          }]
        });

        ws.send(JSON.stringify({ type: "text", token: joke, last: true }));
        assistantSegments.push(joke);
        console.log("Fetched joke:", joke);
      }
    }
  }

  ws.send(JSON.stringify({
    type: "text",
    token: "",
    last: true,
  }));
  console.log("Assistant response complete.");

  const sessionData = sessions.get(ws.callSid);
  sessionData.conversation.push({ role: "assistant", content: assistantSegments.join("") });
}

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" /></Connect></Response>`);
});

fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case "setup":
          const callSid = message.callSid;
          console.log("Setup for call:", callSid);
          ws.callSid = callSid;
          sessions.set(callSid, {conversation: []});
          break;
        case "prompt":
          console.log("Processing prompt:", message.voicePrompt);
          const sessionData = sessions.get(ws.callSid);
          sessionData.conversation.push({role: "user", content: message.voicePrompt});

          aiResponseStream(sessionData.conversation, ws);
          break;
        case "interrupt":
          console.log("Handling interruption; last utterance: ", message.utteranceUntilInterrupt);
          handleInterrupt(ws.callSid, message.utteranceUntilInterrupt);
          break;
        default:
          console.warn("Unknown message type received:", message.type);
          break;
      }
    });

    ws.on("close", () => {
      console.log("WebSocket connection closed");
      sessions.delete(ws.callSid);
    });
  });
});

function handleInterrupt(callSid, utteranceUntilInterrupt) {
  const sessionData = sessions.get(callSid);
  const conversation = sessionData.conversation;

  let updatedConversation = [...conversation];

  const interruptedIndex = updatedConversation.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      message.content.includes(utteranceUntilInterrupt)
  );

  if (interruptedIndex !== -1) {
    const interruptedMessage = updatedConversation[interruptedIndex];
    const interruptPosition = interruptedMessage.content.indexOf(utteranceUntilInterrupt);
    const truncatedContent = interruptedMessage.content.substring(0, interruptPosition + utteranceUntilInterrupt.length);

    updatedConversation[interruptedIndex] = {
      ...interruptedMessage,
      content: truncatedContent,
    };

    updatedConversation = updatedConversation.filter(
      (message, index) =>
        !(index > interruptedIndex && message.role === "assistant"),
    );
  }

  sessionData.conversation = updatedConversation;
  sessions.set(callSid, sessionData);
}

try {
  fastify.listen({ port: PORT });
  console.log(`Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
