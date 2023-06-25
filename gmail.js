const express = require("express");
const app = express();
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const fs = require("fs").promises;
const { google } = require("googleapis");
//const { google } = require("googleapis");
//console.log(google);
const port = 8080;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

app.get('/', async (req, res) => {
  // Load Clients secrets from a local file.
  const credentials = await fs.readFile('credentials.json');

  // Authorize a client credentials, then call the Gmail API.
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, 'credentials.json'),
    scopes: SCOPES,
  });

  console.log('THIS IS AUTH = ', auth);

  const gmail = google.gmail({
    version: "v1",
    auth: auth,
  });
  

  const response = await gmail.users.labels.list({
    userId: 'me',
  });

  const LABEL_NAME = "Vacation Auto-Reply";

  // Load Credentials from file
  async function loadCredentials() {
    const filePath = path.join(process.cwd(), 'credentials.json');
    const content = await fs.readFile(filePath, { encoding: 'utf8' });
    return JSON.parse(content);
  }

  // Get Messages that have no prior replies
  async function getUnrepliedMessages(auth) {
    const gmail = google.gmail({
        version: "v1",
        auth: auth,
      });
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: '-in:chats -from:me -has:userlabels',
    });
    return res.data.messages || [];
  }

  // Sending reply to a message
  async function sendReply(auth, message) {
    const gmail = google.gmail({
        version: "v1",
        auth: auth,
      });      
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From'],
    });

    const subject = res.data.payload.headers.find(
      (header) => header.name === 'Subject'
    ).value;

    const from = res.data.payload.headers.find(
      (header) => header.name === 'From'
    ).value;

    const replyTo = from.match(/<(.*)>/)[1];
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    const replyBody = `Hello,\n\n I am currently on vacation and I will get back to you soon.\n\nBest,\nHemanth Perumalla`;
    const rawMessage = [
      `from: me`,
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${message.id}`,
      `References: ${message.id}`,
      ``,
      replyBody,
    ].join('\n');

    const encodedMessage = Buffer.from(rawMessage).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '__').replace(/=+$/, '');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });
  }

  // Create a Label Function for the Mail
  async function createLabel(auth) {
    const gmail = google.gmail({
        version: "v1",
        auth: auth,
      });
    try {
      const res = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: LABEL_NAME,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      return res.data.id;
    } catch (err) {
      if (err.code == 409) {
        // Label already exists
        const res = await gmail.users.labels.list({
          userId: 'me',
        });
        const label = res.data.labels.find((label) => label.name === LABEL_NAME);
        return label.id;
      } else {
        throw err;
      }
    }
  }

  // Add label to a message and move it to the label folder.
  async function addLabel(auth, message, labelId) {
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.modify({
      userId: 'me',
      id: message.id,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: ["INBOX"],
      },
    });
  }

  // Main Function
  async function main() {
    // Create a Label for the app
    const labelId = await createLabel(auth);
    console.log(`Created or found label with id ${labelId}`);

    // Repeat the following steps at random intervals
    setInterval(async () => {
      // Get Messages that have no prior replies
      const messages = await getUnrepliedMessages(auth);
      console.log(`Found ${messages.length} unreplied messages`);

      // For each message
      for (const message of messages) {
        // Sending reply to the message
        await sendReply(auth, message);
        console.log(`Sent reply to message with id ${message.id}`);

        // Add label to the message and move it to the label folder
        await addLabel(auth, message, labelId);
        console.log(`Added label to message with id ${message.id}`);
      }
    }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000);
  }

  main().catch(console.error);

  const labels = response.data.labels;
  res.send("You have successfully subscribed to our service.");
});

app.listen(port, () => {
  console.log(`Vacation email is running at http://localhost:${port}`);
});
