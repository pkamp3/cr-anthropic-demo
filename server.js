import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hi! I am an A I voice assistant powered by Twilio and Anthropic. Ask me anything!";
const SYSTEM_PROMPT =
  "You are a helpful assistant. This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20. Do not include emojis in your responses. Do not include bullet points, asterisks, or special symbols.";
const sessions = new Map();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function aiResponseStream(conversation, ws) {
  const stream = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: conversation,
    system: SYSTEM_PROMPT,
    stream: true,
  });

  let fullResponse = "";

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      const content = chunk.delta.text;

      // Send each token
      console.log(content);
      ws.send(
        JSON.stringify({
          type: "text",
          token: content,
          last: false,
        })
      );
      fullResponse += content;
    }
  }

  // Send final message to indicate completion
  ws.send(
    JSON.stringify({
      type: "text",
      token: "",
      last: true,
    })
  );

  return fullResponse;
}

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.all("/twiml", async (request, reply) => {
  reply
    .type("text/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" /></Connect></Response>`
    );
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
          sessions.set(callSid, []);
          break;
        case "prompt":
          console.log("Processing prompt:", message.voicePrompt);
          const sessionData = sessions.get(ws.callSid);
          sessionData.push({
            role: "user",
            content: message.voicePrompt,
          });
          const response = await aiResponseStream(sessionData, ws);
          if (response) {
            sessionData.push({
              role: "assistant",
              content: response,
            });
          }
          break;
        case "interrupt":
          console.log(
            "Handling interruption; last utterance: ",
            message.utteranceUntilInterrupt
          );
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
  let conversation = sessions.get(callSid);
  // Find the last assistant message that contains the interrupted utterance
  const interruptedIndex = conversation.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      message.utteranceUntilInterrupt !== "" &&
      message.content.includes(utteranceUntilInterrupt)
  );
  if (interruptedIndex !== -1) {
    const interruptedMessage = conversation[interruptedIndex];
    const interruptPosition = interruptedMessage.content.indexOf(
      utteranceUntilInterrupt
    );
    const truncatedContent = interruptedMessage.content.substring(
      0,
      interruptPosition + utteranceUntilInterrupt.length
    );

    // Update the interrupted message with truncated content
    conversation[interruptedIndex] = {
      ...interruptedMessage,
      content: truncatedContent,
    };

    // Remove any subsequent assistant messages
    conversation = conversation.filter(
      (message, index) =>
        !(index > interruptedIndex && message.role === "assistant")
    );
  }
  sessions.set(callSid, conversation);
}

try {
  fastify.listen({ port: PORT });
  console.log(
    `Server running at http://localhost:${PORT} and wss://${DOMAIN}/ws`
  );
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}