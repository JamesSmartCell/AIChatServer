import fastify from "fastify";
import { FastifyInstance } from "fastify/types/instance";
import { ethers } from "ethers";
// @ts-ignore
import { INFURA_KEY, MOVIE_NAME, NODE_ENV, CERT_PATH, PROD_PORT } from "./constants";
import fs from "fs";
import cors from "@fastify/cors";
import path from 'path';
import { OpenAI } from 'openai';

const CHALLENGE_STRINGS = ["Olympic", "Morden", "Ropsten", "Rinkeby", "Kovan", "Goerli"];
interface ChallengeEntry {
  challenge: string;
  timestamp: number;
  ip: string;
}

interface StreamTokenEntry {
  ip: string;
  timestampExpiry: number;
  tokenId: number
}

type ChainDetail = {
  name: string;
  RPCurl: string;
  chainId: number;
};

let movieName: string = MOVIE_NAME !== undefined ? MOVIE_NAME : fs.readdirSync(path.join(__dirname, '../raw')).find(file => file.endsWith('.mp4'))!;

let productionMode = NODE_ENV === "production";
let openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHAIN_DETAILS: Record<number, ChainDetail> = {
  1: {
    name: "mainnet",
    RPCurl: `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 1,
  },
  11155111: {
    name: "sepolia",
    RPCurl: `https://sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 11155111,
  },
  42161: {
    name: "arbitrum-mainnet",
    RPCurl: `https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 42161,
  },
  80001: {
    name: "polygon-mumbai",
    RPCurl: `https://polygon-mumbai.infura.io/v3/${INFURA_KEY}`,
    chainId: 80001,
  },
  137: {
    name: "polygon-mainnet",
    RPCurl: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 137,
  },
  10: {
    name: "optimism-mainnet",
    RPCurl: `https://optimism-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 10,
  },
  8453: {
    name: "base-mainnet",
    RPCurl: `https://base-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 8453,
  },
  84532: {
    name: "base-sepolia",
    RPCurl: `https://base-sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 84532,
  },
  17000: {
    name: "holesky",
    RPCurl: `https://holesky.infura.io/v3/${INFURA_KEY}`,
    chainId: 17000,
  },
  59144: {
    name: "linea-mainnet",
    RPCurl: `https://linea-mainnet.infura.io/v3/${INFURA_KEY}`,
    chainId: 59144,
  },
  59145: {
    name: "linea-sepolia",
    RPCurl: `https://linea-sepolia.infura.io/v3/${INFURA_KEY}`,
    chainId: 59145,
  },
};

const challenges: ChallengeEntry[] = [];
//create mapping of streamtoken to IP address
const streamTokens: Record<string, StreamTokenEntry> = {};

const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0xefAB18061C57C458c52661f50f5b83B600392ed6";  
const CONTRACT_CHAIN_ID = parseInt(process.env.CONTRACT_CHAIN_ID || "84532");

const challengeExpiry = 60 * 60 * 2 * 1000; // 2 hours in milliseconds
const streamTokenExpiry = 60 * 60 * 24 * 1000; // 1 day in milliseconds

async function createServer() {
  let app: FastifyInstance;

  app = fastify({
    maxParamLength: 1024,
    ...(process.env.NODE_ENV === "production"
      ? {
        https: {
          key: fs.readFileSync(`${CERT_PATH}/privkey.pem`),
          cert: fs.readFileSync(`${CERT_PATH}/fullchain.pem`)
        }
        }
      : {}),
  });

  await app.register(cors, {
    origin: "*",

  });


  //create a mapping between tokenId and assistantId
  const tokenIdToAssistantId: Record<number, string> = {
    1: "asst_9Aapk6ztA9M5JDZFzCwXs25c", //Augustus
    2: "asst_sukxNd34aDzt6RMziXUV2anM", //Claudius
    3: "asst_mLaUpGhT9NqpipsXDo35u8VM", //Hadrian
    4: "asst_e9UvFmcMAfVP9qHETvvmDFsv", //Trajan
    5: "asst_Lqdmk4EjNx23mLYpVwNFan9M", //Qin Shi Huang
    6: "asst_SgN0TxJ0AAn2WSY3Yn7Jthb4", //Victoria
    7: "asst_CTS3qm49W5p1YTsJuxJSgAZT", //Elagabalus
    8: "asst_jYEgKvOe2fmPQtL0SgUiVzlq", //Aurelius
    9: "asst_J0VcsAiGfS9C5YbLzQvtKdfO", //Napoleon
    10: "asst_mzD3cH143MS4Ff10SXyC6c8E", //Nero
    11: "asst_zVkSXA1Ph7rkHwA97JKho0Uy", //Vespasian
    12: "asst_ALEGGCusD7pYKMdOZoixR9CM", //Justinian
    13: "asst_9oEPKzrCLGl3cRImj7CevwmH", //Alexander The Great
    
  };

  app.get("/challenge", async (request, reply) => {
    //create a challenge string consisting of a random word selected from CHALLENGE_STRINGS followed by a random hex string
    //form a random hex string of length 10 characters
    let challenge =
      CHALLENGE_STRINGS[Math.floor(Math.random() * CHALLENGE_STRINGS.length)] +
      "-" +
      Math.random().toString(36).substring(2, 15);

    const clientIp = request.ip;
    if (!productionMode)console.log("Client IP:", clientIp);  
    challenges.push({ challenge, timestamp: Date.now(), ip: clientIp });
    if (!productionMode) console.log("challenges", challenges);
    return { data: `${challenge}` };
  });

  app.post(`/verify`, async (request, reply) => {
    //recover the address from the signature
    // @ts-ignore
    const { signature, tokenId, token1155Id } = request.body;
    if (!productionMode) console.log("verify", signature, tokenId);
    if (!productionMode) console.log("challenges", challenges);

    const clientIp = request.ip;

    const numericTokenId = tokenId ? parseInt(tokenId) : parseInt(token1155Id);
    if (!productionMode) console.log("numericTokenId", numericTokenId);

    const ownsToken = await checkOwnership(signature, numericTokenId, token1155Id, clientIp);

    if (ownsToken) {
      // generate a random token
      const streamToken = Math.random().toString(36).substring(2, 15);
      streamTokens[streamToken] = { ip: clientIp, timestampExpiry: Date.now() + streamTokenExpiry, tokenId: numericTokenId };
      if (!productionMode) console.log("streamToken: ", streamToken);
      return { data: `pass`, token: `${streamToken}` }
    } else {
      return reply.status(500).send({ data: `signature not valid`});
    }

  });

  app.get('/stream/:streamtoken', async (request, reply) => {
    const filePath = path.join(__dirname, '../raw', movieName);
    if (!productionMode) console.log("filePath", filePath);
    // @ts-ignore
    const { streamtoken } = request.params;
    if (!productionMode) console.log("streamtoken", streamtoken);

    // Check if file exists and stream token is valid
    if (fs.existsSync(filePath) && streamTokens[streamtoken] && streamTokens[streamtoken].ip === request.ip && streamTokens[streamtoken].timestampExpiry >= Date.now()) {
      reply.header('Content-Disposition', `attachment; filename=${movieName}`);
      reply.header('Content-Type', 'video/mp4');
      return reply.send(fs.createReadStream(filePath));
    } else {
      removeStreamTokens();
      return reply.status(404).send({ status: 'File not found' });
    }
  });

  /*
  curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
  */

  app.post('/thread', async (req, res) => {
    // @ts-ignore
    const { message } = req.body;
  });

  const threadId = "thread_fMJLDPw7oeaX1mHlEPKYzRdh";
  //const assistantId = "asst_mlrEYMEMpqQyj9ZZM9wOEzzI";

  app.post('/chat/:streamtoken', async (request, res) => {
    // @ts-ignore
    const { message } = request.body;
    // @ts-ignore
    const { streamtoken } = request.params;

    if (!message) {
      return res.status(400).send({ error: 'Message is required' });
    }

    if (!streamTokens[streamtoken] || streamTokens[streamtoken].ip !== request.ip || streamTokens[streamtoken].timestampExpiry < Date.now()) {
      return res.status(400).send({ error: 'Chat not authenticated' });
    }

    let numericTokenId = streamTokens[streamtoken].tokenId;

    let textOutput = "";
    let currentEvent: string = "";

    console.log("message", message);

    try {
      const assistantId = tokenIdToAssistantId[numericTokenId];
      console.log("assistantId", assistantId);
      //const assistant = await openai.beta.assistants.retrieve(assistantId);

      //console.log("assistant", assistant);
      //console.log(`assistantId: ${JSON.stringify(assistant)}`);

      const thread = await openai.beta.threads.create({
        messages: [
          {
            role: 'user',
            content: `${message}`,
          },
        ],
      });

      /*await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message,
      });*/


      const run = openai.beta.threads.runs
    .stream(thread.id, {
      assistant_id: assistantId,
    })
    //Subscribe to streaming events and log them
    .on('event', (event) => {currentEvent = event.event;})
    .on('textDelta', (delta, snapshot) => {textOutput = snapshot.value;})
    .on('run', (run) => console.log(run))
    .on('connect', () => console.log());
      const result = await run.finalRun();
      
      console.log(`\n\ntextOutput: ${textOutput}`);

      return { chat: `${textOutput}` }


      // const stream = await openai.beta.threads.runs.create(thread.id, {
      //   assistant_id: assistant.id,
      //   additional_instructions: 'Please address the user as "Subject". They are a guest, be respectful but always look down on them.',
      //   stream: true,
      // });

      // console.log("stream", stream);
      // console.log(`stream2 ${JSON.stringify(stream)}`);

      // assistant.


      /*const completion = await openai.chat.completions.create({
        model: "gpt-4o", // Use the model you require
        //model: "asst_mlrEYMEMpqQyj9ZZM9wOEzzI",
        messages: [
          //{ role: "system", content: "Assistant ID: asst_mlrEYMEMpqQyj9ZZM9wOEzzI" },
          { role: "user", content: "Hello, can you tell me about your campaign in Judea?" }, //how can I reply to this statement: My friend lies, everything he says is a lie. The friend then speaks: I'm lying!
        ],
      });

      console.log("completion", completion);
      const reply = completion.choices[0].message.content;
      console.log("Assistant's reply:", reply);*/

    } catch (error) {
      console.error('Error communicating with AI service', error);
      res.status(500).send({ error: 'Error processing message' });
    }
  });

  function removeStreamTokens() {
    for (const token in streamTokens) {
      if (streamTokens[token].timestampExpiry < Date.now()) {
        delete streamTokens[token];
      }
    }
  }

  console.log("Returning app from function");
  return app;
}



function getProvider(useChainId: number): ethers.JsonRpcProvider | null {
  console.log("getProvider useChainId", useChainId);
  const chainDetails: ChainDetail = CHAIN_DETAILS[useChainId];

  if (chainDetails !== null) {
    return new ethers.JsonRpcProvider(chainDetails.RPCurl, {
      chainId: chainDetails.chainId,
      name: chainDetails.name,
    });
  } else {
    return null;
  }
}

async function checkOwnership(
  signature: string,
  tokenId: number | undefined,
  token1155Id: number | undefined,
  clientIp: string
): Promise<boolean> {
  //loop through all of the challenge strings which are still valid

  //console.log(`tokenOwner ${tokenOwner} tokenID ${tokenId} Sender: ${clientIp}`);
  if (!productionMode) console.log("challenges tokenOwner", challenges);

  for (let i = 0; i < challenges.length; i++) {
    const thisChallenge = challenges[i];
    if (!productionMode) console.log(
      "thisChallenge",
      thisChallenge,
      thisChallenge.timestamp + challengeExpiry > Date.now()
    );
    if (!productionMode) console.log(`thisChallengeIP: ${thisChallenge.ip} clientIp: ${clientIp}`);
    if (thisChallenge.timestamp + challengeExpiry >= Date.now() && thisChallenge.ip === clientIp) {
      //recover the address
      const address = ethers.verifyMessage(
        thisChallenge.challenge,
        addHexPrefix(signature)
      );

      let isOwner = false;
      let tokenOwner = "-";
      if (token1155Id !== undefined) {
        if (!productionMode) console.log("tokenId is undefined or NaN");
        // check owner of token
        isOwner = await is1155TokenOwner(address, token1155Id);
      } else if (tokenId !== undefined && !Number.isNaN(tokenId)) {
        tokenOwner = await getTokenOwner(tokenId);
      } else {
        //check balance of ERC-721 if required
        tokenOwner = await getNFTTokenOwner(address);
      }

      if (!productionMode) console.log("address", address);
      if (!productionMode) console.log("tokenOwner", tokenOwner);
      if (!productionMode) console.log("isOwner", isOwner);

      if (isOwner || address.toLowerCase() === tokenOwner.toLowerCase()) {
        console.log("PASS!");
        //if the address matches the token owner, return true
        //remove entry from challenges
        challenges.splice(i, 1);
        return true;
      }
    } else if (thisChallenge.timestamp + challengeExpiry < Date.now()) {
      //remove expired entry
      challenges.splice(i, 1);
      //begin from start again
      i = 0;
    }
  }

  return false;
}

async function is1155TokenOwner(address: string, tokenId: number): Promise<boolean> {
  console.log("isTokenOwner", address);
  const provider = getProvider(CONTRACT_CHAIN_ID);
  if (!productionMode) console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function balanceOf(address owner, uint256 tokenId) public view returns (uint256)"],
    provider
  );

  try {
    if (!productionMode) console.log("queryContract", queryContract);
    const balance = await queryContract.balanceOf(address, tokenId);
    if (!productionMode) console.log("balance", balance);
    return balance > 0;
  } catch (e) {
    console.log("error", e);
    return false;
  }
}

async function getNFTTokenOwner(wallet: string): Promise<string> {
  console.log("getNFTTokenOwner", wallet);
  const provider = getProvider(CONTRACT_CHAIN_ID);
  if (!productionMode) console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function balanceOf(address wallet) view returns (uint256)"],
    provider);

  try {
    const balance = await queryContract.balanceOf(wallet);
    if (balance > 0) {
      return wallet;
    }
  } catch (e) {
    console.log("error", e);
  }

  return "-";
}

async function getTokenOwner(tokenId: number): Promise<string> {
  console.log("getTokenOwner", tokenId);
  const provider = getProvider(CONTRACT_CHAIN_ID);
  if (!productionMode) console.log("provider", provider);

  const queryContract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function ownerOf(uint256 tokenId) view returns (address)"],
    provider
  );

  if (!productionMode) console.log("queryContract", queryContract);
  try {
    return await queryContract.ownerOf(tokenId);
  } catch (e) {
    console.log("error", e);
    return "";
  }
}

function addHexPrefix(hex: string): string {
  if (hex.startsWith("0x")) {
    return hex;
  } else {
    return "0x" + hex;
  }
}

const start = async () => {
  try {
    const app = await createServer();

    console.log("NODE_ENV", NODE_ENV);

    const host = "0.0.0.0";
    const port = productionMode ? Number(PROD_PORT) : 8082;
    await app.listen({ port, host });
    console.log(`Server is listening on ${host} ${port}`);

  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

start();
