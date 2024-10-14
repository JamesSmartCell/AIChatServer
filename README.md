# AIChat Gating KeyServer

This server is used to gate access to a video.

1. Call the `/challenge` endpoint to get a challenge.
2. Sign the challenge.
3. Call the `/verify` endpoint to verify the signature, and receive a chat session token.
4. Call the `/chat/:session` endpoint to send a chat message.

Build and run:
1. Create the .env file based on the .env.example file.
2. Replace the example movie in the /raw folder with your gated movie.

```bash
npm install
npm run dev
```