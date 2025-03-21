import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from '@fastify/formbody';
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING = "Hi! I am a voice assistant powered by Twilio and Anthropic. Ask me anything!";
const SYSTEM_PROMPT = "You are a helpful assistant. This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20. Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.";
const sessions = new Map();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function aiResponseStream(conversation, ws) {
  const stream = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 1024,
    messages: conversation,
    system: SYSTEM_PROMPT,
    stream: true,
  });

  const assistantSegments = [];
  console.log("Received response chunks:");
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      const content = chunk.delta.text;

      // Send each token
      console.log(content);
      ws.send(JSON.stringify({
        type: "text",
        token: content,
        last: false,
      }));
      assistantSegments.push(content);
    }
  }

  // Send the final "last" token when streaming completes
  ws.send(JSON.stringify({
    type: "text",
    token: "",
    last: true,
  }));
  console.log("Assistant response complete.");

  const sessionData = sessions.get(ws.callSid);
  sessionData.conversation.push({ role: "assistant", content: assistantSegments.join("") });
  console.log("Final accumulated response:", assistantSegments.join(""));
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
          sessions.set(callSid, { conversation: [] });
          break;
        case "prompt":
          console.log("Processing prompt:", message.voicePrompt);
          const sessionData = sessions.get(ws.callSid);
          sessionData.conversation.push({ role: "user", content: message.voicePrompt });

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

  const interruptedIndex = updatedConversation.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.content.includes(utteranceUntilInterrupt),
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