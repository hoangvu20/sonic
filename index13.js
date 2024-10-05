const fs = require("fs");
const readlineSync = require("readline-sync");
const colors = require("colors");

const { displayHeader } = require("./src/displayUtils");

const {
  Connection,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  PublicKey,
  Keypair,
} = require("@solana/web3.js");
const bip39 = require("bip39");
const { derivePath } = require("ed25519-hd-key");
const base58 = require("bs58");

const DEVNET_URL = "https://devnet.sonic.game/";
const connection = new Connection(DEVNET_URL, "confirmed");

async function sendSol(fromKeypair, toPublicKey, amount) {
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL); // Chuyển đổi số tiền gửi sang lamports
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toPublicKey,
      lamports: lamports, // Sử dụng lamports đã chuyển đổi
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    fromKeypair,
  ]);
  console.log(colors.green("Transaction confirmed with signature:"), signature);
}

function generateRandomAddresses(count) {
  return Array.from({ length: count }, () =>
    Keypair.generate().publicKey.toString()
  );
}

function getKeypairFromPrivateKey(privateKey) {
  return Keypair.fromSecretKey(base58.decode(privateKey));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm gửi giao dịch với logic thử lại
const sendTransactionWithRetry = async (fromKeypair, toPublicKey, amount) => {
  const retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      await sendSol(fromKeypair, toPublicKey, amount);
      return; // Nếu gửi thành công, thoát khỏi vòng lặp
    } catch (error) {
      console.error(colors.red(`Attempt ${i + 1} failed: ${error.message}`));
      if (i === retries - 1) {
        console.error(
          colors.red(`Failed to send SOL after ${retries} attempts`)
        );
      }
      await delay(2000); // Chờ 2 giây trước khi thử lại
    }
  }
};

(async () => {
  displayHeader();
  let seedPhrasesOrKeys = JSON.parse(
    fs.readFileSync("privateKeys13.json", "utf-8")
  );
  if (!Array.isArray(seedPhrasesOrKeys) || seedPhrasesOrKeys.length === 0) {
    throw new Error(
      colors.red("privateKeys7.json is not set correctly or is empty")
    );
  }

  const addressCount = Math.floor(Math.random() * (120 - 108 + 1)) + 108;
  const randomAddresses = generateRandomAddresses(addressCount);

  let rentExemptionAmount;
  try {
    rentExemptionAmount =
      (await connection.getMinimumBalanceForRentExemption(0)) /
      LAMPORTS_PER_SOL;
    console.log(
      colors.yellow(
        `Minimum balance required for rent exemption: ${rentExemptionAmount} SOL`
      )
    );
  } catch (error) {
    console.error(
      colors.red(
        "Failed to fetch minimum balance for rent exemption. Using default value."
      )
    );
    rentExemptionAmount = 0.001;
  }

  for (const [index, seedOrKey] of seedPhrasesOrKeys.entries()) {
    let fromKeypair = getKeypairFromPrivateKey(seedOrKey);
    console.log(
      colors.yellow(
        `Sending SOL from account ${
          index + 1
        }: ${fromKeypair.publicKey.toString()}`
      )
    );

    // Kiểm tra số dư trước khi gửi
    const balance = await connection.getBalance(fromKeypair.publicKey);
    const minAmount = 0.0011 * LAMPORTS_PER_SOL; // Chuyển đổi sang lamports

    if (balance < minAmount) {
      // Ghi vào file notBalance.txt nếu số dư không đủ
      const notEnoughSolMessage = `${fromKeypair.publicKey.toString()}, ${base58.encode(
        fromKeypair.secretKey
      )}\n`;
      fs.appendFileSync("notBalance.txt", notEnoughSolMessage, "utf-8");
      console.log(
        colors.red(
          `Not enough SOL for account: ${fromKeypair.publicKey.toString()}`
        )
      );
      continue; // Bỏ qua ví này và tiếp tục với ví khác
    }

    for (const address of randomAddresses) {
      const maxAmount = 0.001199;
      let amountToSend = (
        Math.random() * (maxAmount - 0.0011) +
        0.0011
      ).toFixed(6); // Tạo ngẫu nhiên từ 0.0011 đến 0.001199
      amountToSend = parseFloat(amountToSend); // Chuyển đổi về số thực

      const lamportsToSend = Math.floor(amountToSend * LAMPORTS_PER_SOL); // Chuyển đổi sang lamports

      // Kiểm tra xem số dư có đủ cho giao dịch không
      if (balance < lamportsToSend) {
        console.log(
          colors.red(`Not enough SOL to send ${amountToSend} to ${address}.`)
        );
        continue; // Bỏ qua địa chỉ này nếu không đủ SOL
      }

      const minDelay = 1000; // 1 giây
      const maxDelay = 3000; // 3 giây
      const delayBetweenTx =
        Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay; // Tạo ngẫu nhiên từ 1000 đến 3000 ms
      const toPublicKey = new PublicKey(address);
      try {
        await sendTransactionWithRetry(fromKeypair, toPublicKey, amountToSend);
        console.log(
          colors.green(
            `Successfully sent ${amountToSend} SOL to ${address} after waiting ${delayBetweenTx} ms`
          )
        );
      } catch (error) {
        console.error(colors.red(`Failed to send SOL to ${address}:`), error);
      }
      await delay(delayBetweenTx);
    }
  }
})();
