// TonWeb is JavaScript SDK (Web and NodeJS) for TON

const TonWeb = require("tonweb");

// For calculations in the blockchain, we use BigNumber (BN.js). https://github.com/indutny/bn.js
// Don't use regular {Number} for coins, etc., it has not enough size and there will be loss of accuracy.

const BN = TonWeb.utils.BN;

// Blockchain does not operate with fractional numbers like `0.5`.
// `toNano` function converts TON to nanoton - smallest unit.
// 1 TON = 10^9 nanoton; 1 nanoton = 0.000000001 TON;
// So 0.5 TON is 500000000 nanoton

const toNano = TonWeb.utils.toNano;
const fromNano = TonWeb.utils.fromNano;

function random(min, max) {
  return min + Math.random() * (max - min);
}

// For improving dev speed we use global obj state
const globalState = {};
let globalChannelA = {};
let globalChannelB = {};
let globalFromWalletA = {};
let globalFromWalletB = {};

const closeOffchainChannel = async () => {
  let channelSign;
  let channelVerify;
  let fromWallet;
  const lastSignChannel = globalState.channelStateInfo.lastSignChannel;
  const channelState = globalState.channelStateInfo.channelState;
  console.log(`[closeOffchainChannel] channelState: `, channelState);

  if (!lastSignChannel) {
    throw new Error(
      `No lastSignChannel in closeOffchainChannel: ${lastSignChannel}`
    );
  }

  if (lastSignChannel === "A") {
    channelSign = globalChannelA;
    channelVerify = globalChannelB;
    fromWallet = globalFromWalletB;
  } else if (lastSignChannel === "B") {
    channelSign = globalChannelB;
    channelVerify = globalChannelA;
    fromWallet = globalFromWalletA;
  }

  const signatureClose = await channelSign.signClose(channelState);

  if (!(await channelVerify.verifyClose(channelState, signatureClose))) {
    throw new Error(
      `[closeOffchainChannel] invalid close signature channelVerify: ${channelVerify}`
    );
  }

  try {
    await fromWallet
      .close({
        ...channelState,
        hisSignature: signatureClose,
      })
      .send(toNano("0.05"));
    console.log("Closed succefully!");
  } catch (error) {
    throw new Error(`[closeOffchainChannel] error ${error}`);
  }
};

const createOffchainTransfer = async (type, amount) => {
  if (!type) {
    throw new Error(`No transfer type: ${type} for createOffchainTransfer!`);
  }
  const balanceAPrev = globalState.channelStateInfo.channelState.balanceA;
  const balanceBPrev = globalState.channelStateInfo.channelState.balanceB;

  let balanceANew = +fromNano(balanceAPrev);
  let balanceBNew = +fromNano(balanceBPrev);
  console.log(
    "[createOffchainTransfer] +fromNano(balanceAPrev): ",
    balanceANew
  );
  console.log(
    "[createOffchainTransfer] +fromNano(balanceBPrev): ",
    balanceBNew
  );

  console.log("[createOffchainTransfer]  type: ", type);

  if (type === "userWin") {
    // A creates new state - subtracts amount from B's balance, adds amount to A's balance, increases B's seqno by 1
    balanceANew = +(balanceANew + amount).toFixed(10);
    balanceBNew = +(balanceBNew - amount).toFixed(10);
    globalState.channelStateInfo.seqnoBCounterNum += 1;
  } else if (type === "userLoose") {
    // A creates new state - subtracts amount from A's balance, adds amount to B's balance, increases A's seqno by 1

    balanceANew = +(balanceANew - amount).toFixed(10);
    balanceBNew = +(balanceBNew + amount).toFixed(10);
    globalState.channelStateInfo.seqnoACounterNum += 1;
  } else {
    throw new Error(`[createOffchainTransfer] not such type for type ${type}`);
  }

  // console.log('balanceA = ', data.balanceA.toString())
  // console.log('balanceB = ', data.balanceB.toString())
  //----------------------------------------------------------------------
  // FIRST OFFCHAIN TRANSFER - A sends 0.1 TON to B

  console.log(
    "[createOffchainTransfer] afterChanges balanceANew: ",
    balanceANew
  );
  console.log(
    "[createOffchainTransfer] afterChanges balanceBNew: ",
    balanceBNew
  );

  const channelState = {
    balanceA: toNano(balanceANew.toString()),
    balanceB: toNano(balanceBNew.toString()),
    seqnoA: new BN(globalState.channelStateInfo.seqnoACounterNum),
    seqnoB: new BN(globalState.channelStateInfo.seqnoBCounterNum),
  };
  globalState.channelStateInfo.channelState = channelState;

  // A signs this state and send signed state to B (e.g. via websocket)
  let channelSign;
  let channelVerify;
  let lastSignChannel;

  if (type === "userWin") {
    lastSignChannel = "B";
    channelSign = globalChannelB;
    channelVerify = globalChannelA;
    globalState.channelStateInfo.type = type;
  } else if (type === "userLoose") {
    lastSignChannel = "A";
    channelSign = globalChannelA;
    channelVerify = globalChannelB;
  }

  const signature = await channelSign.signState(channelState);
  // A checks that the state is changed according to the rules, signs this state, send signed state to B (e.g. via websocket)
  if (!(await channelVerify.verifyState(channelState, signature))) {
    throw new Error(
      `Invalid signature channelVerify: ${channelVerify} channelSign: ${channelSign}`
    );
  }
  const signatureFromVerifyer = await channelVerify.signState(channelState);
  globalState.channelStateInfo.lastSignChannel = lastSignChannel;

  return true;
};

const initPaymentChannels = async (playerBalanceForGame) => {
  const providerUrl = "https://testnet.toncenter.com/api/v2/jsonRPC"; // TON HTTP API url. Use this url for testnet
  const apiKey =
    "7044e2f1f261ab0027eaab1d8131ef07becb5d07ccdcb1437a64c3e9e07364d5"; // Obtain your API key in https://t.me/tontestnetapibot
  const tonweb = new TonWeb(new TonWeb.HttpProvider(providerUrl, { apiKey })); // Initialize TON SDK

  //----------------------------------------------------------------------
  // PARTIES
  // The payment channel is established between two participants A and B.
  // Each has own secret key, which he does not reveal to the other.

  // New secret key can be generated by `tonweb.utils.newSeed()`
  // const newSeedA = Buffer.from(tonweb.utils.newSeed()).toString("base64");
  // const newSeedB = Buffer.from(tonweb.utils.newSeed()).toString("base64");

  // console.log("newSeedA: ", newSeedA);
  // console.log("newSeedB: ", newSeedB);

  // Old wallet a generated on node
  const OlDgeneratedSeedA = "549vwAXJUEyoUfSEdcmQtTmIZ8BBtA3ph8MzURK5S44=";
  // Old wallet b generated on node
  const OLDgeneratedSeedB = "1+DB9/3MzOcpc1QRX5j4NgxcRx1X/QRHtAKaDuWt7zA==";

  const generatedSeedA = "P9cClZKjujYHqDNCETf+hOyUYt0/9sEFqnlgxueLuEs=";
  const generatedSeedB = "NyFOgUIyIVX4svOFlFubOQ+SSdltOrJUdEk0hU999S4=";

  const seedA = TonWeb.utils.base64ToBytes(generatedSeedA); // A's private (secret) key
  const keyPairA = tonweb.utils.keyPairFromSeed(seedA); // Obtain key pair (public key and private key)

  const seedB = TonWeb.utils.base64ToBytes(generatedSeedB); // B's private (secret) key
  const keyPairB = tonweb.utils.keyPairFromSeed(seedB); // Obtain key pair (public key and private key)

  // if you are new to cryptography then the public key is like a login, and the private key is like a password.
  // Login can be shared with anyone, password cannot be shared with anyone.

  // With a key pair, you can create a wallet.
  // Note that this is just an object, we are not deploying anything to the blockchain yet.
  // Transfer some amount of test coins to this wallet address (from your wallet app).
  // To check you can use blockchain explorer https://testnet.tonscan.org/address/<WALLET_ADDRESS>

  const walletA = tonweb.wallet.create({
    publicKey: keyPairA.publicKey,
  });

  // EQBvrU2PvfsXtFPFyQ-hlzcuTFFDKN_Mj93rHOxKAo2kk708 EQCWuxUGHF4K0-y3upHVaYsW0dRJZtRY3TbZ9mp91zbtwDz2

  const walletAddressA = await walletA.getAddress(); // address of this wallet in blockchain
  // 200 ton here
  // walletAddressA old on node EQBC9N6zXcb_JW5dFb-CLg-pcnq7PYsqzfUwpwvTCeX9SLAU
  // walletAddressA new on node EQBvrU2PvfsXtFPFyQ-hlzcuTFFDKN_Mj93rHOxKAo2kk708
  console.log("walletAddressA = ", walletAddressA.toString(true, true, true));

  const walletB = tonweb.wallet.create({
    publicKey: keyPairB.publicKey,
  });

  // 200 ton
  // walletAddressB old on node EQBIfM5Xs8Mr4LBIX9kirbdkq-aWupeL-KIfYkpPCRaFo1zl
  // walletAdressB new on browser EQCWuxUGHF4K0-y3upHVaYsW0dRJZtRY3TbZ9mp91zbtwDz2
  const walletAddressB = await walletB.getAddress(); // address of this wallet in blockchain
  console.log("walletAddressB = ", walletAddressB.toString(true, true, true));

  //----------------------------------------------------------------------
  // DEPLOY WALLETS
  // const deployA = walletA.deploy(keyPairA.secretKey);
  // const deployASended = await deployA.send();
  // console.log('deployA: ', deployA);
  // console.log('deployASended: ', deployASended);

  // const deployB = walletB.deploy(keyPairB.secretKey);
  // const deployBSended = await deployB.send();
  // console.log('deployB: ', deployB);
  // console.log('deployBSended: ', deployBSended);

  //----------------------------------------------------------------------
  // PREPARE PAYMENT CHANNEL

  // The parties agree on the configuration of the payment channel.
  // They share information about the payment channel ID, their public keys, their wallet addresses for withdrawing coins, initial balances.
  // They share this information off-chain, for example via a websocket.


  const channelInitState = {
    // Mock for now for next iteration it should be playerBalanceForGame
    balanceA: toNano("1"), // A's initial balance in Toncoins. Next A will need to make a top-up for this amount
    // For now casino deposits will be hardcoded for now
    balanceB: toNano("2"), // B's initial balance in Toncoins. Next B will need to make a top-up for this amount
    seqnoA: new BN(0), // initially 0
    seqnoB: new BN(0), // initially 0
  };

  globalState.channelStateInfo = {
    seqnoACounterNum: 0,
    seqnoBCounterNum: 0,
    channelState: channelInitState,
  };

  // TODO: genetate uniqid for channel in next iteration
  const channelId = random(0,1134);
  const channelConfig = {
    channelId: new BN(channelId), // Channel ID, for each new channel there must be a new ID
    addressA: walletAddressA, // A's funds will be withdrawn to this wallet address after the channel is closed
    addressB: walletAddressB, // B's funds will be withdrawn to this wallet address after the channel is closed
    initBalanceA: channelInitState.balanceA,
    initBalanceB: channelInitState.balanceB,
  };

  // Each on their side creates a payment channel object with this configuration

  const channelA = tonweb.payments.createChannel({
    ...channelConfig,
    isA: true,
    myKeyPair: keyPairA,
    hisPublicKey: keyPairB.publicKey,
  });

  const channelAddress = await channelA.getAddress(); // address of this payment channel smart-contract in blockchain
  console.log("channelAddress=", channelAddress.toString(true, true, true));

  const channelB = tonweb.payments.createChannel({
    ...channelConfig,
    isA: false,
    myKeyPair: keyPairB,
    hisPublicKey: keyPairA.publicKey,
  });

  if ((await channelB.getAddress()).toString() !== channelAddress.toString()) {
    throw new Error("Channels address not same");
  }

  globalChannelA = channelA;
  console.log("globalChannelA init: ", globalChannelA);

  globalChannelB = channelB;
  console.log("globalChannelB init: ", globalChannelB);

  // Interaction with the smart contract of the payment channel is carried out by sending messages from the wallet to it.
  // So let's create helpers for such sends.

  const fromWalletA = channelA.fromWallet({
    wallet: walletA,
    secretKey: keyPairA.secretKey,
  });

  const fromWalletB = channelB.fromWallet({
    wallet: walletB,
    secretKey: keyPairB.secretKey,
  });

  globalFromWalletA = fromWalletA;
  globalFromWalletB = fromWalletB;

  console.log("globalFromWalletA init: ", globalFromWalletA);

  //----------------------------------------------------------------------
  // NOTE:
  // Further we will interact with the blockchain.
  // After each interaction with the blockchain, we need to wait for execution. In the TON blockchain, this is usually about 5 seconds.
  // In this example, the interaction code happens right after each other - that won't work.
  // To study the example, you can put a `return` after each send.
  // In a real application, you will need to check that the smart contract of the channel has changed
  // (for example, by calling its get-method and checking the `state`) and only then do the following action.

  //----------------------------------------------------------------------
  // DEPLOY PAYMENT CHANNEL FROM WALLET A

  // Wallet A must have a balance.
  // 0.05 TON is the amount to execute this transaction on the blockchain. The unused portion will be returned.
  // After this action, a smart contract of our payment channel will be created in the blockchain.

  await fromWalletA.deploy().send(toNano("0.05"));

  // To check you can use blockchain explorer https://testnet.tonscan.org/address/<CHANNEL_ADDRESS>
  // We can also call get methods on the channel (it's free) to get its current data.

  try {
    console.log("Channel state: ", await channelA.getChannelState());
  } catch (err) {
    throw new Error('[Channel state error]: ', err);
  }
  const data = await channelA.getData();
  console.log("balanceA = ", data.balanceA.toString());
  console.log("balanceB = ", data.balanceB.toString());
  // TOP UP

  // Now each parties must send their initial balance from the wallet to the channel contract.

  await fromWalletA
    .topUp({ coinsA: channelInitState.balanceA, coinsB: new BN(0) })
    .send(channelInitState.balanceA.add(toNano("0.05"))); // +0.05 TON to network fees

  await fromWalletB
    .topUp({ coinsA: new BN(0), coinsB: channelInitState.balanceB })
    .send(channelInitState.balanceB.add(toNano("0.05"))); // +0.05 TON to network fees

  // to check, call the get method - the balances should change

  // INIT

  // After everyone has done top-up, we can initialize the channel from any wallet

  await fromWalletA.init(channelInitState).send(toNano("0.05"));

  // to check, call the get method - `state` should change to `TonWeb.payments.PaymentChannel.STATE_OPEN`
};

export const roulette = () => {
  let bankValue = 1000;
  let currentBet = 0;
  let wager = 5;
  let lastWager = 0;
  let bet = [];
  let numbersBet = [];
  let previousNumbers = [];

  let numRed = [
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ];
  let wheelnumbersAC = [
    0, 26, 3, 35, 12, 28, 7, 29, 18, 22, 9, 31, 14, 20, 1, 33, 16, 24, 5, 10,
    23, 8, 30, 11, 36, 13, 27, 6, 34, 17, 25, 2, 21, 4, 19, 15, 32,
  ];

  let container = document.createElement('div');
  container.setAttribute('id', 'container');
    const rootElement = document.getElementById('root');
    rootElement.append(container);

  startGame();

  let wheel = document.getElementsByClassName("wheel")[0];
  let ballTrack = document.getElementsByClassName("ballTrack")[0];

  function resetGame() {
    bankValue = 1000;
    currentBet = 0;
    wager = 5;
    bet = [];
    numbersBet = [];
    previousNumbers = [];
    document.getElementById("betting_board").remove();
    document.getElementById("notification").remove();
    buildBettingBoard();
  }

  function startGame() {
    buildWheel();
    buildBettingBoard();
    initPaymentChannels();
  }

  function gameOver() {
    let notification = document.createElement("div");
    notification.setAttribute("id", "notification");
    let nSpan = document.createElement("span");
    nSpan.setAttribute("class", "nSpan");
    nSpan.innerText = "Bankrupt";
    notification.append(nSpan);

    let nBtn = document.createElement("div");
    nBtn.setAttribute("class", "nBtn");
    nBtn.innerText = "Play again";
    nBtn.onclick = function () {
      resetGame();
    };
    notification.append(nBtn);
    container.prepend(notification);
  }

  function buildWheel() {
    let wheel = document.createElement("div");
    wheel.setAttribute("class", "wheel");

    let outerRim = document.createElement("div");
    outerRim.setAttribute("class", "outerRim");
    wheel.append(outerRim);

    let numbers = [
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
      24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ];
    for (let i = 0; i < numbers.length; i++) {
      let a = i + 1;
      let spanClass = numbers[i] < 10 ? "single" : "double";
      let sect = document.createElement("div");
      sect.setAttribute("id", "sect" + a);
      sect.setAttribute("class", "sect");
      let span = document.createElement("span");
      span.setAttribute("class", spanClass);
      span.innerText = numbers[i];
      sect.append(span);
      let block = document.createElement("div");
      block.setAttribute("class", "block");
      sect.append(block);
      wheel.append(sect);
    }

    let pocketsRim = document.createElement("div");
    pocketsRim.setAttribute("class", "pocketsRim");
    wheel.append(pocketsRim);

    let ballTrack = document.createElement("div");
    ballTrack.setAttribute("class", "ballTrack");
    let ball = document.createElement("div");
    ball.setAttribute("class", "ball");
    ballTrack.append(ball);
    wheel.append(ballTrack);

    let pockets = document.createElement("div");
    pockets.setAttribute("class", "pockets");
    wheel.append(pockets);

    let cone = document.createElement("div");
    cone.setAttribute("class", "cone");
    wheel.append(cone);

    let turret = document.createElement("div");
    turret.setAttribute("class", "turret");
    wheel.append(turret);

    let turretHandle = document.createElement("div");
    turretHandle.setAttribute("class", "turretHandle");
    let thendOne = document.createElement("div");
    thendOne.setAttribute("class", "thendOne");
    turretHandle.append(thendOne);
    let thendTwo = document.createElement("div");
    thendTwo.setAttribute("class", "thendTwo");
    turretHandle.append(thendTwo);
    wheel.append(turretHandle);

    container.append(wheel);
  }

  function buildBettingBoard() {
    let bettingBoard = document.createElement("div");
    bettingBoard.setAttribute("id", "betting_board");

    let wl = document.createElement("div");
    wl.setAttribute("class", "winning_lines");

    var wlttb = document.createElement("div");
    wlttb.setAttribute("id", "wlttb_top");
    wlttb.setAttribute("class", "wlttb");
    for (let i = 0; i < 11; i++) {
      let j = i;
      var ttbbetblock = document.createElement("div");
      ttbbetblock.setAttribute("class", "ttbbetblock");
      var numA = 1 + 3 * j;
      var numB = 2 + 3 * j;
      var numC = 3 + 3 * j;
      var numD = 4 + 3 * j;
      var numE = 5 + 3 * j;
      var numF = 6 + 3 * j;
      let num =
        numA +
        ", " +
        numB +
        ", " +
        numC +
        ", " +
        numD +
        ", " +
        numE +
        ", " +
        numF;
      var objType = "double_street";
      ttbbetblock.onclick = function () {
        setBet(this, num, objType, 5);
      };
      ttbbetblock.oncontextmenu = function (e) {
        e.preventDefault();
        removeBet(this, num, objType, 5);
      };
      wlttb.append(ttbbetblock);
    }
    wl.append(wlttb);

    for (let c = 1; c < 4; c++) {
      let d = c;
      var wlttb = document.createElement("div");
      wlttb.setAttribute("id", "wlttb_" + c);
      wlttb.setAttribute("class", "wlttb");
      for (let i = 0; i < 12; i++) {
        let j = i;
        var ttbbetblock = document.createElement("div");
        ttbbetblock.setAttribute("class", "ttbbetblock");
        ttbbetblock.onclick = function () {
          if (d == 1 || d == 2) {
            var numA = 2 - (d - 1) + 3 * j;
            var numB = 3 - (d - 1) + 3 * j;
            var num = numA + ", " + numB;
          } else {
            var numA = 1 + 3 * j;
            var numB = 2 + 3 * j;
            var numC = 3 + 3 * j;
            var num = numA + ", " + numB + ", " + numC;
          }
          var objType = d == 3 ? "street" : "split";
          var odd = d == 3 ? 11 : 17;
          setBet(this, num, objType, odd);
        };
        ttbbetblock.oncontextmenu = function (e) {
          e.preventDefault();
          if (d == 1 || d == 2) {
            var numA = 2 - (d - 1) + 3 * j;
            var numB = 3 - (d - 1) + 3 * j;
            var num = numA + ", " + numB;
          } else {
            var numA = 1 + 3 * j;
            var numB = 2 + 3 * j;
            var numC = 3 + 3 * j;
            var num = numA + ", " + numB + ", " + numC;
          }
          var objType = d == 3 ? "street" : "split";
          var odd = d == 3 ? 11 : 17;
          removeBet(this, num, objType, odd);
        };
        wlttb.append(ttbbetblock);
      }
      wl.append(wlttb);
    }

    for (let c = 1; c < 12; c++) {
      let d = c;
      var wlrtl = document.createElement("div");
      wlrtl.setAttribute("id", "wlrtl_" + c);
      wlrtl.setAttribute("class", "wlrtl");
      for (let i = 1; i < 4; i++) {
        let j = i;
        var rtlbb = document.createElement("div");
        rtlbb.setAttribute("class", "rtlbb" + i);
        var numA = 3 + 3 * (d - 1) - (j - 1);
        var numB = 6 + 3 * (d - 1) - (j - 1);
        let num = numA + ", " + numB;
        rtlbb.onclick = function () {
          setBet(this, num, "split", 17);
        };
        rtlbb.oncontextmenu = function (e) {
          e.preventDefault();
          removeBet(this, num, "split", 17);
        };
        wlrtl.append(rtlbb);
      }
      wl.append(wlrtl);
    }

    for (let c = 1; c < 3; c++) {
      var wlcb = document.createElement("div");
      wlcb.setAttribute("id", "wlcb_" + c);
      wlcb.setAttribute("class", "wlcb");
      for (let i = 1; i < 12; i++) {
        let count = c == 1 ? i : i + 11;
        var cbbb = document.createElement("div");
        cbbb.setAttribute("id", "cbbb_" + count);
        cbbb.setAttribute("class", "cbbb");
        var numA = "2";
        var numB = "3";
        var numC = "5";
        var numD = "6";
        let num =
          count >= 1 && count < 12
            ? parseInt(numA) +
              (count - 1) * 3 +
              ", " +
              (parseInt(numB) + (count - 1) * 3) +
              ", " +
              (parseInt(numC) + (count - 1) * 3) +
              ", " +
              (parseInt(numD) + (count - 1) * 3)
            : parseInt(numA) -
              1 +
              (count - 12) * 3 +
              ", " +
              (parseInt(numB) - 1 + (count - 12) * 3) +
              ", " +
              (parseInt(numC) - 1 + (count - 12) * 3) +
              ", " +
              (parseInt(numD) - 1 + (count - 12) * 3);
        var objType = "corner_bet";
        cbbb.onclick = function () {
          setBet(this, num, objType, 8);
        };
        cbbb.oncontextmenu = function (e) {
          e.preventDefault();
          removeBet(this, num, objType, 8);
        };
        wlcb.append(cbbb);
      }
      wl.append(wlcb);
    }

    bettingBoard.append(wl);

    let bbtop = document.createElement("div");
    bbtop.setAttribute("class", "bbtop");
    let bbtopBlocks = ["1 to 18", "19 to 36"];
    for (let i = 0; i < bbtopBlocks.length; i++) {
      let f = i;
      var bbtoptwo = document.createElement("div");
      bbtoptwo.setAttribute("class", "bbtoptwo");
      let num =
        f == 0
          ? "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18"
          : "19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36";
      var objType = f == 0 ? "outside_low" : "outside_high";
      bbtoptwo.onclick = function () {
        setBet(this, num, objType, 1);
      };
      bbtoptwo.oncontextmenu = function (e) {
        e.preventDefault();
        removeBet(this, num, objType, 1);
      };
      bbtoptwo.innerText = bbtopBlocks[i];
      bbtop.append(bbtoptwo);
    }
    bettingBoard.append(bbtop);

    let numberBoard = document.createElement("div");
    numberBoard.setAttribute("class", "number_board");

    let zero = document.createElement("div");
    zero.setAttribute("class", "number_0");
    var objType = "zero";
    var odds = 35;
    zero.onclick = function () {
      setBet(this, "0", objType, odds);
    };
    zero.oncontextmenu = function (e) {
      e.preventDefault();
      removeBet(this, "0", objType, odds);
    };
    let nbnz = document.createElement("div");
    nbnz.setAttribute("class", "nbn");
    nbnz.innerText = "0";
    zero.append(nbnz);
    numberBoard.append(zero);

    var numberBlocks = [
      3,
      6,
      9,
      12,
      15,
      18,
      21,
      24,
      27,
      30,
      33,
      36,
      "2 to 1",
      2,
      5,
      8,
      11,
      14,
      17,
      20,
      23,
      26,
      29,
      32,
      35,
      "2 to 1",
      1,
      4,
      7,
      10,
      13,
      16,
      19,
      22,
      25,
      28,
      31,
      34,
      "2 to 1",
    ];
    var redBlocks = [
      1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ];
    for (let i = 0; i < numberBlocks.length; i++) {
      let a = i;
      var nbClass = numberBlocks[i] == "2 to 1" ? "tt1_block" : "number_block";
      var colourClass = redBlocks.includes(numberBlocks[i])
        ? " redNum"
        : nbClass == "number_block"
        ? " blackNum"
        : "";
      var numberBlock = document.createElement("div");
      numberBlock.setAttribute("class", nbClass + colourClass);
      numberBlock.onclick = function () {
        if (numberBlocks[a] != "2 to 1") {
          setBet(this, "" + numberBlocks[a] + "", "inside_whole", 35);
        } else {
          let num =
            a == 12
              ? "3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36"
              : a == 25
              ? "2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35"
              : "1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34";
          setBet(this, num, "outside_column", 2);
        }
      };
      numberBlock.oncontextmenu = function (e) {
        e.preventDefault();
        if (numberBlocks[a] != "2 to 1") {
          removeBet(this, "" + numberBlocks[a] + "", "inside_whole", 35);
        } else {
          let num =
            a == 12
              ? "3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36"
              : a == 25
              ? "2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35"
              : "1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34";
          removeBet(this, num, "outside_column", 2);
        }
      };
      var nbn = document.createElement("div");
      nbn.setAttribute("class", "nbn");
      nbn.innerText = numberBlocks[i];
      numberBlock.append(nbn);
      numberBoard.append(numberBlock);
    }
    bettingBoard.append(numberBoard);

    let bo3Board = document.createElement("div");
    bo3Board.setAttribute("class", "bo3_board");
    let bo3Blocks = ["1 to 12", "13 to 24", "25 to 36"];
    for (let i = 0; i < bo3Blocks.length; i++) {
      let b = i;
      var bo3Block = document.createElement("div");
      bo3Block.setAttribute("class", "bo3_block");
      bo3Block.onclick = function () {
        let num =
          b == 0
            ? "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12"
            : b == 1
            ? "13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24"
            : "25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36";
        setBet(this, num, "outside_dozen", 2);
      };
      bo3Block.oncontextmenu = function (e) {
        e.preventDefault();
        let num =
          b == 0
            ? "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12"
            : b == 1
            ? "13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24"
            : "25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36";
        removeBet(this, num, "outside_dozen", 2);
      };
      bo3Block.innerText = bo3Blocks[i];
      bo3Board.append(bo3Block);
    }
    bettingBoard.append(bo3Board);

    let otoBoard = document.createElement("div");
    otoBoard.setAttribute("class", "oto_board");
    let otoBlocks = ["EVEN", "RED", "BLACK", "ODD"];
    for (let i = 0; i < otoBlocks.length; i++) {
      let d = i;
      var colourClass =
        otoBlocks[i] == "RED"
          ? " redNum"
          : otoBlocks[i] == "BLACK"
          ? " blackNum"
          : "";
      var otoBlock = document.createElement("div");
      otoBlock.setAttribute("class", "oto_block" + colourClass);
      otoBlock.onclick = function () {
        let num =
          d == 0
            ? "2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36"
            : d == 1
            ? "1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36"
            : d == 2
            ? "2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35"
            : "1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35";
        setBet(this, num, "outside_oerb", 1);
      };
      otoBlock.oncontextmenu = function (e) {
        let num =
          d == 0
            ? "2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36"
            : d == 1
            ? "1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36"
            : d == 2
            ? "2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35"
            : "1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35";
        e.preventDefault();
        removeBet(this, num, "outside_oerb", 1);
      };
      otoBlock.innerText = otoBlocks[i];
      otoBoard.append(otoBlock);
    }
    bettingBoard.append(otoBoard);

    let chipDeck = document.createElement("div");
    chipDeck.setAttribute("class", "chipDeck");
    let chipValues = [1, 5, 10, 100, "clear"];
    for (let i = 0; i < chipValues.length; i++) {
      let cvi = i;
      let chipColour =
        i == 0
          ? "red"
          : i == 1
          ? "blue cdChipActive"
          : i == 2
          ? "orange"
          : i == 3
          ? "gold"
          : "clearBet";
      let chip = document.createElement("div");
      chip.setAttribute("class", "cdChip " + chipColour);
      chip.onclick = function () {
        if (cvi !== 4) {
          let cdChipActive = document.getElementsByClassName("cdChipActive");
          for (i = 0; i < cdChipActive.length; i++) {
            cdChipActive[i].classList.remove("cdChipActive");
          }
          let curClass = this.getAttribute("class");
          if (!curClass.includes("cdChipActive")) {
            this.setAttribute("class", curClass + " cdChipActive");
          }
          wager = parseInt(chip.childNodes[0].innerText);
        } else {
          bankValue = bankValue + currentBet;
          currentBet = 0;
          document.getElementById("bankSpan").innerText =
            "" + bankValue.toLocaleString("en-GB") + "";
          document.getElementById("betSpan").innerText =
            "" + currentBet.toLocaleString("en-GB") + "";
          clearBet();
          removeChips();
        }
      };
      let chipSpan = document.createElement("span");
      chipSpan.setAttribute("class", "cdChipSpan");
      chipSpan.innerText = chipValues[i];
      chip.append(chipSpan);
      chipDeck.append(chip);
    }
    bettingBoard.append(chipDeck);

    let bankContainer = document.createElement("div");
    bankContainer.setAttribute("class", "bankContainer");

    let bank = document.createElement("div");
    bank.setAttribute("class", "bank");
    let bankSpan = document.createElement("span");
    bankSpan.setAttribute("id", "bankSpan");
    bankSpan.innerText = "" + bankValue.toLocaleString("en-GB") + "";
    bank.append(bankSpan);
    bankContainer.append(bank);

    let bet = document.createElement("div");
    bet.setAttribute("class", "bet");
    let betSpan = document.createElement("span");
    betSpan.setAttribute("id", "betSpan");
    betSpan.innerText = "" + currentBet.toLocaleString("en-GB") + "";
    bet.append(betSpan);
    bankContainer.append(bet);
    bettingBoard.append(bankContainer);

    let pnBlock = document.createElement("div");
    pnBlock.setAttribute("class", "pnBlock");
    let pnContent = document.createElement("div");
    pnContent.setAttribute("id", "pnContent");
    pnContent.onwheel = function (e) {
      e.preventDefault();
      pnContent.scrollLeft += e.deltaY;
    };
    pnBlock.append(pnContent);
    bettingBoard.append(pnBlock);

    container.append(bettingBoard);

    let testOffchainPayments = document.createElement("button");
    testOffchainPayments.setAttribute("class", "testOffchainPayments");
    testOffchainPayments.innerText = "Test Ton Payments";
    testOffchainPayments.onclick = async function () {
      console.log("Starting testing payments: ");
      console.log(`Starting 1st offchainTransfer type=userLoose amount=0.1 `);
      await createOffchainTransfer("userLoose", 0.1);
      console.log(`Starting 2st offchainTransfer type=userLoose amount=0.2 `);

      await createOffchainTransfer("userLoose", 0.2);
      console.log(`Starting 3st offchainTransfer type=userWin amount=1.1 `);

      await createOffchainTransfer("userWin", 1.1);
      console.log(`Closing Offchain Channel`);

      await closeOffchainChannel();
    };
    container.append(testOffchainPayments);
  }

  function clearBet() {
    bet = [];
    numbersBet = [];
  }

  function setBet(e, n, t, o) {
    lastWager = wager;
    wager = bankValue < wager ? bankValue : wager;
    if (wager > 0) {
      if (!container.querySelector(".spinBtn")) {
        let spinBtn = document.createElement("div");
        spinBtn.setAttribute("class", "spinBtn");
        spinBtn.innerText = "spin";
        spinBtn.onclick = function () {
          this.remove();
          spin();
        };
        container.append(spinBtn);
      }
      bankValue = bankValue - wager;
      currentBet = currentBet + wager;
      document.getElementById("bankSpan").innerText =
        "" + bankValue.toLocaleString("en-GB") + "";
      document.getElementById("betSpan").innerText =
        "" + currentBet.toLocaleString("en-GB") + "";
      for (let i = 0; i < bet.length; i++) {
        if (bet[i].numbers == n && bet[i].type == t) {
          bet[i].amt = bet[i].amt + wager;
          let chipColour =
            bet[i].amt < 5
              ? "red"
              : bet[i].amt < 10
              ? "blue"
              : bet[i].amt < 100
              ? "orange"
              : "gold";
          e.querySelector(".chip").style.cssText = "";
          e.querySelector(".chip").setAttribute("class", "chip " + chipColour);
          let chipSpan = e.querySelector(".chipSpan");
          chipSpan.innerText = bet[i].amt;
          return;
        }
      }
      var obj = {
        amt: wager,
        type: t,
        odds: o,
        numbers: n,
      };
      bet.push(obj);

      let numArray = n.split(",").map(Number);
      for (let i = 0; i < numArray.length; i++) {
        if (!numbersBet.includes(numArray[i])) {
          numbersBet.push(numArray[i]);
        }
      }

      if (!e.querySelector(".chip")) {
        let chipColour =
          wager < 5
            ? "red"
            : wager < 10
            ? "blue"
            : wager < 100
            ? "orange"
            : "gold";
        let chip = document.createElement("div");
        chip.setAttribute("class", "chip " + chipColour);
        let chipSpan = document.createElement("span");
        chipSpan.setAttribute("class", "chipSpan");
        chipSpan.innerText = wager;
        chip.append(chipSpan);
        e.append(chip);
      }
    }
  }

  function spin() {
    var winningSpin = Math.floor(Math.random() * 36);
    spinWheel(winningSpin);
    setTimeout(function () {
      if (numbersBet.includes(winningSpin)) {
        let winValue = 0;
        let betTotal = 0;
        for (let i = 0; i < bet.length; i++) {
          var numArray = bet[i].numbers.split(",").map(Number);
          if (numArray.includes(winningSpin)) {
            bankValue = bankValue + bet[i].odds * bet[i].amt + bet[i].amt;
            winValue = winValue + bet[i].odds * bet[i].amt;
            betTotal = betTotal + bet[i].amt;
          }
        }
        win(winningSpin, winValue, betTotal);
      }

      currentBet = 0;
      document.getElementById("bankSpan").innerText =
        "" + bankValue.toLocaleString("en-GB") + "";
      document.getElementById("betSpan").innerText =
        "" + currentBet.toLocaleString("en-GB") + "";

      let pnClass = numRed.includes(winningSpin)
        ? "pnRed"
        : winningSpin == 0
        ? "pnGreen"
        : "pnBlack";
      let pnContent = document.getElementById("pnContent");
      let pnSpan = document.createElement("span");
      pnSpan.setAttribute("class", pnClass);
      pnSpan.innerText = winningSpin;
      pnContent.append(pnSpan);
      pnContent.scrollLeft = pnContent.scrollWidth;

      bet = [];
      numbersBet = [];
      removeChips();
      wager = lastWager;
      if (bankValue == 0 && currentBet == 0) {
        gameOver();
      }
    }, 10000);
  }

  function win(winningSpin, winValue, betTotal) {
    if (winValue > 0) {
      const totalWin = winValue + betTotal;
      console.log("totalWin: ", totalWin);

      let notification = document.createElement("div");
      notification.setAttribute("id", "notification");
      let nSpan = document.createElement("div");
      nSpan.setAttribute("class", "nSpan");
      let nsnumber = document.createElement("span");
      nsnumber.setAttribute("class", "nsnumber");
      nsnumber.style.cssText = numRed.includes(winningSpin)
        ? "color:red"
        : "color:black";
      nsnumber.innerText = winningSpin;
      nSpan.append(nsnumber);
      let nsTxt = document.createElement("span");
      nsTxt.innerText = " Win";
      nSpan.append(nsTxt);
      let nsWin = document.createElement("div");
      nsWin.setAttribute("class", "nsWin");
      let nsWinBlock = document.createElement("div");
      nsWinBlock.setAttribute("class", "nsWinBlock");
      nsWinBlock.innerText = "Bet: " + betTotal;
      nSpan.append(nsWinBlock);
      nsWin.append(nsWinBlock);
      nsWinBlock = document.createElement("div");
      nsWinBlock.setAttribute("class", "nsWinBlock");
      nsWinBlock.innerText = "Win: " + winValue;
      nSpan.append(nsWinBlock);
      nsWin.append(nsWinBlock);
      nsWinBlock = document.createElement("div");
      nsWinBlock.setAttribute("class", "nsWinBlock");
      nsWinBlock.innerText = "Payout: " + totalWin;
      nsWin.append(nsWinBlock);
      nSpan.append(nsWin);
      notification.append(nSpan);
      container.prepend(notification);
      setTimeout(function () {
        notification.style.cssText = "opacity:0";
      }, 3000);
      setTimeout(function () {
        notification.remove();
      }, 4000);
    }
  }

  function removeBet(e, n, t, o) {
    wager = wager == 0 ? 100 : wager;
    for (let i = 0; i < bet.length; i++) {
      if (bet[i].numbers == n && bet[i].type == t) {
        if (bet[i].amt != 0) {
          wager = bet[i].amt > wager ? wager : bet[i].amt;
          bet[i].amt = bet[i].amt - wager;
          bankValue = bankValue + wager;
          currentBet = currentBet - wager;
          document.getElementById("bankSpan").innerText =
            "" + bankValue.toLocaleString("en-GB") + "";
          document.getElementById("betSpan").innerText =
            "" + currentBet.toLocaleString("en-GB") + "";
          if (bet[i].amt == 0) {
            e.querySelector(".chip").style.cssText = "display:none";
          } else {
            let chipColour =
              bet[i].amt < 5
                ? "red"
                : bet[i].amt < 10
                ? "blue"
                : bet[i].amt < 100
                ? "orange"
                : "gold";
            e.querySelector(".chip").setAttribute(
              "class",
              "chip " + chipColour
            );
            let chipSpan = e.querySelector(".chipSpan");
            chipSpan.innerText = bet[i].amt;
          }
        }
      }
    }

    if (currentBet == 0 && container.querySelector(".spinBtn")) {
      document.getElementsByClassName("spinBtn")[0].remove();
    }
  }

  function spinWheel(winningSpin) {
    for (let i = 0; i < wheelnumbersAC.length; i++) {
      if (wheelnumbersAC[i] == winningSpin) {
        var degree = i * 9.73 + 362;
      }
    }
    wheel.style.cssText = "animation: wheelRotate 5s linear infinite;";
    ballTrack.style.cssText = "animation: ballRotate 1s linear infinite;";

    let style;
    setTimeout(function () {
      ballTrack.style.cssText = "animation: ballRotate 2s linear infinite;";
      style = document.createElement("style");
      style.type = "text/css";
      style.innerText =
        "@keyframes ballStop {from {transform: rotate(0deg);}to{transform: rotate(-" +
        degree +
        "deg);}}";
      document.head.appendChild(style);
    }, 2000);
    setTimeout(function () {
      ballTrack.style.cssText = "animation: ballStop 3s linear;";
    }, 6000);
    setTimeout(function () {
      ballTrack.style.cssText = "transform: rotate(-" + degree + "deg);";
    }, 9000);
    setTimeout(function () {
      wheel.style.cssText = "";
      style.remove();
    }, 10000);
  }

  function removeChips() {
    var chips = document.getElementsByClassName("chip");
    if (chips.length > 0) {
      for (let i = 0; i < chips.length; i++) {
        chips[i].remove();
      }
      removeChips();
    }
  }
};
