const fs = require("fs");
require("colors");
const solana = require("@solana/web3.js");
const axios = require("axios").default;
const base58 = require("bs58");
const nacl = require("tweetnacl");
const { connection } = require("./src/solanaUtils");
const { HEADERS } = require("./src/headers");
const { displayHeader } = require("./src/displayUtils");
const readlineSync = require("readline-sync");
const moment = require("moment");

const PRIVATE_KEYS = JSON.parse(
  fs.readFileSync("privateKeysClaim2.json", "utf-8")
);

function getKeypair(privateKey) {
  const decodedPrivateKey = base58.decode(privateKey);
  return solana.Keypair.fromSecretKey(decodedPrivateKey);
}

async function getToken(privateKey) {
  try {
    const { data } = await axios({
      url: "https://odyssey-api-beta.sonic.game/auth/sonic/challenge",
      params: {
        wallet: getKeypair(privateKey).publicKey,
      },
      headers: HEADERS,
    });

    const sign = nacl.sign.detached(
      Buffer.from(data.data),
      getKeypair(privateKey).secretKey
    );
    const signature = Buffer.from(sign).toString("base64");
    const publicKey = getKeypair(privateKey).publicKey;
    const encodedPublicKey = Buffer.from(publicKey.toBytes()).toString(
      "base64"
    );
    const response = await axios({
      url: "https://odyssey-api-beta.sonic.game/auth/sonic/authorize",
      method: "POST",
      headers: HEADERS,
      data: {
        address: publicKey,
        address_encoded: encodedPublicKey,
        signature,
      },
    });

    return response.data.data.token;
  } catch (error) {
    console.log(`Error fetching token: ${error}`.red);
  }
}

async function getProfile(token) {
  try {
    const { data } = await axios({
      url: "https://odyssey-api-beta.sonic.game/user/rewards/info",
      method: "GET",
      headers: { ...HEADERS, Authorization: token },
    });

    return data.data;
  } catch (error) {
    console.log(`Error fetching profile: ${error}`.red);
  }
}

async function doTransactions(tx, keypair, retries = 3) {
  try {
    const bufferTransaction = tx.serialize();
    const signature = await connection.sendRawTransaction(bufferTransaction);
    await connection.confirmTransaction(signature);
    return signature;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying transaction... (${retries} retries left)`.yellow);
      await new Promise((res) => setTimeout(res, 1000));
      return doTransactions(tx, keypair, retries - 1);
    } else {
      throw error;
    }
  }
}

async function openMysteryBox(token, keypair, retries = 3) {
  try {
    const { data } = await axios({
      url: "https://odyssey-api-beta.sonic.game/user/rewards/mystery-box/build-tx",
      method: "GET",
      headers: { ...HEADERS, Authorization: token },
    });

    const txBuffer = Buffer.from(data.data.hash, "base64");
    const tx = solana.Transaction.from(txBuffer);
    tx.partialSign(keypair);
    const signature = await doTransactions(tx, keypair);
    const response = await axios({
      url: "https://odyssey-api-beta.sonic.game/user/rewards/mystery-box/open",
      method: "POST",
      headers: { ...HEADERS, Authorization: token },
      data: {
        hash: signature,
      },
    });

    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.log(
        `Retrying opening mystery box... (${retries} retries left)`.yellow
      );
      await new Promise((res) => setTimeout(res, 1000));
      return openMysteryBox(token, keypair, retries - 1);
    } else {
      throw error;
    }
  }
}

async function processPrivateKey(privateKey) {
  try {
    const publicKey = getKeypair(privateKey).publicKey.toBase58();
    const token = await getToken(privateKey);
    let profile = await getProfile(token); // Thay đổi const thành let

    if (profile.wallet_balance > 0) {
      const balance = profile.wallet_balance / solana.LAMPORTS_PER_SOL;
      const ringBalance = profile.ring;
      let availableBoxes = profile.ring_monitor;

      console.log(`Hello ${publicKey}! Here are your details:`.green);
      console.log(`Solana Balance: ${balance} SOL`.green);
      console.log(`Ring Balance: ${ringBalance}`.green);
      console.log(`Available Box(es): ${availableBoxes}`.green);
      console.log("");

      if (availableBoxes === 0) {
        console.log(`No boxes available to open for ${publicKey}.`.red);
        return;
      }

      // Mở từng hộp có sẵn
      while (availableBoxes > 0) {
        console.log(
          `[ ${moment().format("HH:mm:ss")} ] Opening box ${
            profile.ring_monitor - availableBoxes + 1
          } of ${profile.ring_monitor}`.yellow
        );
        const openedBox = await openMysteryBox(token, getKeypair(privateKey));

        if (openedBox.data.success) {
          console.log(
            `[ ${moment().format(
              "HH:mm:ss"
            )} ] Box opened successfully! Status: ${
              openedBox.status
            } | Amount: ${openedBox.data.amount}`.green
          );
        } else {
          console.log(
            `[ ${moment().format("HH:mm:ss")} ] Failed to open box. Retrying...`
              .red
          );
        }

        availableBoxes--;

        // Cập nhật profile sau khi mở
        if (availableBoxes > 0) {
          profile = await getProfile(token); // profile được cập nhật lại
          availableBoxes = profile.ring_monitor; // Cập nhật lại số box còn lại
        }
      }

      console.log(`All boxes opened for ${publicKey}.`.cyan);
    } else {
      console.log(`Insufficient balance for wallet: ${publicKey}.`.red);
    }
  } catch (error) {
    console.log(`Error processing private key: ${error}`.red);
  }
  console.log("");
}

(async () => {
  try {
    displayHeader();
    for (let i = 0; i < PRIVATE_KEYS.length; i++) {
      const privateKey = PRIVATE_KEYS[i];
      console.log(`Processing private key ${i + 1}...`.green);
      await processPrivateKey(privateKey);
    }

    console.log("All private keys processed, all boxes opened.".cyan);
  } catch (error) {
    console.log(`Error in bot operation: ${error}`.red);
  } finally {
    console.log("Thanks for having us! Subscribe: https://t.me/LTHKT".magenta);
  }
})();
