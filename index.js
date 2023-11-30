const express = require('express');
const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const { config } = require('./config');

const app = express();
app.use(cors());

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const port = 3001;

AWS.config.loadFromPath('./config.aws.env.production.json');

const sendEmail = async ({
  toEmail,
  dataSubject,
  dataHtml,
  dataText,
  footerMessage = true,
  simpleTemplate = false,
}) => {
  let headerHtml = `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8"/>
    </head>
    <body>
    <div class="template-root">
    <div class="template-content">
    `;

  const headerText = '';

  let footerHtml = `
    </div>
    </div>
    </body></html>`;
  let footerText;

  if (simpleTemplate) {
    headerHtml = ` <!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8"/>
    <body>`;
    footerHtml = `
    </body></html>
    `;
    footerText = `
    `;
  }
  const params = {
    Destination: {
      ToAddresses: [toEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: headerHtml + dataHtml + footerHtml,
        },
        Text: {
          Charset: 'UTF-8',
          Data: headerText + dataText + footerText,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: dataSubject,
      },
    },
    Source: 'kontakt@zwiedzaniekrakowa.com',
    ReplyToAddresses: ['kontakt@zwiedzaniekrakowa.com'],
  };

  const sendPromise = new AWS.SES({
    apiVersion: '2010-12-01',
    region: 'eu-west-1',
  })
    .sendEmail(params)
    .promise();

  const messageId = await sendPromise;
  return messageId;
};

// sendEmail({
//   dataSubject: 'zamowienie',
// });

app.get('/', (req, res) => {
  res.send(':)');
});

app.post('/order', async (req, res) => {
  // console.log(req.body);

  const { name, email, phone, items, inpost } = req.body;
  const dataHtml = `
<p>Zamowienie:</p>
${items.map((item) => {
  return `<p><b>${item.quantity}x</b> ${item.name}</p>`;
})}
<hr>
<p>Klient:</p>
<p>Imie: ${name}</p>
<p>Email: ${email}</p>
<p>Telefon: ${phone}</p>
<p>Inpost: <br />
${inpost.name}<br />
${inpost.address.line1}<br />
${inpost.address.line2}<br />
</p>
  `;
  const dataText = ``;
  const dataSubject = `nowe zamowienie od ${email}`;
  const toEmail = 'ad.kasprowicz@gmail.com';

  const { clientId, clientSecret } = config.payu.pl;

  const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress;

  const tokenRequest = new Promise((resolve2, reject2) => {
    const data = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
    const options = {
      hostname: 'secure.payu.com',
      port: 443,
      path: '/pl/standard/user/oauth/authorize',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length,
      },
    };
    const reqPaymentToken = https.request(options, (resPaymentToken) => {
      let body = [];
      resPaymentToken
        .on('data', (chunk) => {
          body.push(chunk);
        })
        .on('end', () => {
          body = Buffer.concat(body).toString();
          const resob = JSON.parse(body);
          resolve2(resob);
        });
    });
    reqPaymentToken.on('error', (error) => {
      console.error(error);
    });
    reqPaymentToken.write(data);
    reqPaymentToken.end();
  });

  const itemList = [
    {
      id: 1,
      name: 'Swieca Smok Wawelski',
      price: 29.99,
    },
  ];
  const inpostPrice = 16.99;

  const totalAmount = items.reduce((acc, item) => {
    return (
      acc +
      item.quantity *
        // eslint-disable-next-line eqeqeq
        (itemList.find((i) => i.id == item.id).price + inpostPrice)
    );
  }, 0);

  const resJson = await tokenRequest;

  console.log({ resJson });

  // const { i = 1 } = req.queryStringParameters;
  // const iPLN = 1 * 100;
  const notifyUrl = `https://api.krakowguideshop.com/payment-notify`;
  const data = JSON.stringify({
    continueUrl: 'https://krakowguideshop.com/thanks',
    notifyUrl,
    customerIp: ip,
    merchantPosId: String(clientId),
    description: 'Zamowienie',
    currencyCode: 'PLN',
    totalAmount: String(totalAmount * 100),
    buyer: {
      email,
    },
    products: items.map((item) => {
      return {
        // name: item.name,
        // eslint-disable-next-line eqeqeq
        name: itemList.find((i) => i.id == item.id).name,
        unitPrice: String(
          // eslint-disable-next-line eqeqeq
          itemList.find((i) => i.id == item.id).price * 100
        ),
        quantity: String(item.quantity),
      };
    }),
  });
  const options = {
    hostname: 'secure.payu.com',
    port: 443,
    path: '/api/v2_1/orders/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      Authorization: `Bearer ${resJson.access_token}`,
    },
  };
  const reqPayment = https.request(options, (resPayment) => {
    let body = [];
    resPayment
      .on('data', (chunk) => {
        body.push(chunk);
      })
      .on('end', () => {
        body = Buffer.concat(body).toString();
        const resOrder = JSON.parse(body);

        console.log(resOrder);

        const { redirectUri, orderId } = resOrder;
        // console.log({
        //   body,
        //   resOrder,
        // });

        sendEmail({
          toEmail,
          dataHtml,
          dataText,
          dataSubject: `${dataSubject} - ID ${orderId}`,
        });

        res.json({
          redirectUri,
        });
      });
  });
  reqPayment.on('error', (error) => {
    console.error({
      error,
    });
  });
  reqPayment.write(data);
  reqPayment.end();
});

app.post('/payment-notify', async (req, res) => {
  // console.log(req.body);

  if (typeof req.body === 'string') {
    req.body = JSON.parse(req.body);
  }

  const { order } = req.body;
  if (!order) return;
  const { description, buyer, status, orderId } = order;
  if (status === 'COMPLETED') {
    const { email, firstName = '', lastName = '' } = buyer;

    sendEmail({
      toEmail: 'ad.kasprowicz@gmail.com',
      // 'kontakt@zwiedzaniekrakowa.com'
      dataHtml: 'potwierdzenie wplaty',
      dataText: 'potwierdzenie wplaty',
      dataSubject: `payu - wplacil ${email} - ID ${orderId}`,
    });

    res.json({
      ok: 2,
    });
  }
});

app.listen(port, () => {
  console.log(`app listening on port ${port}`);
});

/*

const getPaymentURLTour2 = async (event) => {
  event.body = JSON.parse(event.body);

  return new Promise((resolve, reject) => {
    const tokenRequest = new Promise((resolve2, reject2) => {
      const data = `grant_type=client_credentials&client_id=${config.payu.pl.clientId}&client_secret=${config.payu.pl.clientSecret}`;
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/pl/standard/user/oauth/authorize',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resob = JSON.parse(body);
            resolve2(resob);
          });
      });
      req.on('error', (error) => {
        console.error(error);
      });
      req.write(data);
      req.end();
    });
    tokenRequest.then(async (resJson) => {
      const { price, groupId, postId, name, email } = event.body;
      const iPLN = price * 100;
      const continueUrl = `https://zwiedzaniekrakowa.com/virtual-tours/?payment=1&groupId=${groupId}&postId=${postId}`;
      const notifyUrl = `https://lw5w20f910.execute-api.eu-west-1.amazonaws.com/default/zwiedzanie?notify=1`;
      const data = JSON.stringify({
        continueUrl,
        notifyUrl,
        customerIp: event.headers['X-Forwarded-For'],
        merchantPosId: String(clientId),
        description: name,
        currencyCode: 'PLN',
        totalAmount: String(iPLN),
        ...(email
          ? {
              buyer: {
                email,
              },
            }
          : {}),
        products: [
          {
            name,
            unitPrice: String(iPLN),
            quantity: '1',
          },
        ],
      });
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/api/v2_1/orders/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${resJson.access_token}`,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resOrder = JSON.parse(body);
            const { redirectUri } = resOrder;
            const response = {
              statusCode: 200,
              isBase64Encoded: false,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({
                ok: 2,
                redirectUri,
              }),
            };
            resolve(response);
          });
      });
      req.on('error', (error) => {
        console.error({
          error,
        });
      });
      req.write(data);
      req.end();
    });
  });
};

const notify = async (event) => {
  const transporter = nodemailer.createTransport({
    SES: new AWS.SES({
      apiVersion: '2010-12-01',
      region: 'eu-west-1',
    }),
  });

  if (typeof event.body === 'string') {
    event.body = JSON.parse(event.body);
  }
  const { order } = event.body;
  if (!order) return;
  const { description, buyer, status } = order;
  if (status === 'COMPLETED') {
    const { email, firstName = '', lastName = '' } = buyer;
    const html = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
          event: ${description}
          <br/><br/>
          buyer:<br/>
          ${email}<br/>
          ${firstName} ${lastName}
          <br/><br/>
          </body>
        </html>
      `;

    const emailParams = {
      from: 'kontakt@zwiedzaniekrakowa.com',
      to: 'kontakt@zwiedzaniekrakowa.com',
      bcc: '',
      subject: `wplacil - ${email} - ${description}`,
      html,
      attachments: [],
    };

    return new Promise((resolve, reject) => {
      transporter.sendMail(emailParams, async (error, info) => {
        //   if (error) {
        //     console.error(error);
        //     return reject(error);
        //   }
        // console.log('transporter.sendMail result', info);
        resolve({
          statusCode: 200,
          isBase64Encoded: false,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            ok: 2,
          }),
        });
      });
    });
  }

  return {
    statusCode: 200,
    isBase64Encoded: false,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      ok: 2,
    }),
  };
};

const getPaymentURLTour = async (event) => {
  return new Promise((resolve, reject) => {
    const tokenRequest = new Promise((resolve2, reject2) => {
      const data = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/pl/standard/user/oauth/authorize',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resob = JSON.parse(body);
            resolve2(resob);
          });
      });
      req.on('error', (error) => {
        console.error(error);
      });
      req.write(data);
      req.end();
    });
    tokenRequest.then(async (resJson) => {
      const { i = 1 } = event.queryStringParameters;
      // const buyerEmail = Buffer.from(e, 'base64').toString();
      const iPLN = i * 100;
      const notifyUrl = `https://lw5w20f910.execute-api.eu-west-1.amazonaws.com/default/zwiedzanie?notify=1`;
      const data = JSON.stringify({
        continueUrl: 'https://www.facebook.com/zwiedzaniekrakowacom/groups/',
        notifyUrl,
        customerIp: event.headers['X-Forwarded-For'],
        merchantPosId: String(clientId),
        description: 'Wirtualne zwiedzanie Live',
        currencyCode: 'PLN',
        totalAmount: String(iPLN),
        // buyer: {
        //     email: buyerEmail,
        // },
        products: [
          {
            name: `Wirtualne zwiedzanie Wawel Live ${i}`,
            unitPrice: String(iPLN),
            quantity: '1',
          },
        ],
      });
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/api/v2_1/orders/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${resJson.access_token}`,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resOrder = JSON.parse(body);
            const { redirectUri } = resOrder;
            const response = {
              statusCode: 301,
              headers: {
                Location: redirectUri,
              },
            };
            resolve(response);
          });
      });
      req.on('error', (error) => {
        console.error({
          error,
        });
      });
      req.write(data);
      req.end();
    });
  });
};

const getPaymentURLTour3 = async (event) => {
  return new Promise((resolve, reject) => {
    const tokenRequest = new Promise((resolve2, reject2) => {
      const data = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/pl/standard/user/oauth/authorize',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resob = JSON.parse(body);
            resolve2(resob);
          });
      });
      req.on('error', (error) => {
        console.error(error);
      });
      req.write(data);
      req.end();
    });
    tokenRequest.then(async (resJson) => {
      const { getPaymentUrlTour3 } = event.queryStringParameters;
      // const buyerEmail = Buffer.from(e, 'base64').toString();

      let tour = {
        price: 9,
      };
      if (getPaymentUrlTour3 === '2') {
        tour = {
          ...tour,
          name: 'Live Droga Krolewska',
          groupId: '689286538491701',
        };
      }
      if (getPaymentUrlTour3 === '3') {
        tour = {
          ...tour,
          name: 'Live Kazimierz',
          groupId: '296224771396167',
        };
      }
      if (getPaymentUrlTour3 === '4') {
        tour = {
          ...tour,
          name: 'Live Wokol Rynku',
          groupId: '2710516389185061',
        };
      }

      const iPLN = tour.price * 100;
      const name = `${tour.name} - Wirtualne Zwiedzanie`;
      const notifyUrl = `https://lw5w20f910.execute-api.eu-west-1.amazonaws.com/default/zwiedzanie?notify=1`;
      const data = JSON.stringify({
        continueUrl: `https://www.facebook.com/groups/${tour.groupId}`,
        notifyUrl,
        customerIp: event.headers['X-Forwarded-For'],
        merchantPosId: String(clientId),
        description: name,
        currencyCode: 'PLN',
        totalAmount: String(iPLN),
        // buyer: {
        //     email: buyerEmail,
        // },
        products: [
          {
            name,
            unitPrice: String(iPLN),
            quantity: '1',
          },
        ],
      });
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/api/v2_1/orders/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${resJson.access_token}`,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resOrder = JSON.parse(body);
            const { redirectUri } = resOrder;
            const response = {
              statusCode: 301,
              headers: {
                Location: redirectUri,
              },
            };
            resolve(response);
          });
      });
      req.on('error', (error) => {
        console.error({
          error,
        });
      });
      req.write(data);
      req.end();
    });
  });
};

const getPaymentURLBook = async (event) => {
  return new Promise((resolve, reject) => {
    const tokenRequest = new Promise((resolve2, reject2) => {
      const data = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/pl/standard/user/oauth/authorize',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resob = JSON.parse(body);
            resolve2(resob);
          });
      });
      req.on('error', (error) => {
        console.error(error);
      });
      req.write(data);
      req.end();
    });
    tokenRequest.then(async (resJson) => {
      const { getPaymentUrlBook } = event.queryStringParameters;

      let tour = {
        price: 14,
      };
      if (getPaymentUrlBook === '1') {
        tour = {
          ...tour,
          name: 'Droga Krolewska',
          file: 'krakow-droga-krolewska-00c00df.pdf',
        };
      }
      if (getPaymentUrlBook === '2') {
        tour = {
          ...tour,
          name: 'Wawel',
          file: 'krakow-wzgorze-wawelskie-f88941d.pdf',
        };
      }
      if (getPaymentUrlBook === '3') {
        tour = {
          ...tour,
          name: 'Kazimierz',
          file: 'krakow-kazimierz-992g77cc.pdf',
        };
      }
      if (getPaymentUrlBook === '4') {
        tour = {
          ...tour,
          name: 'Kazimierz Chrzescijanski',
          file: 'krakow-kazimierz-ch-1004120d3.pdf',
        };
      }
      if (getPaymentUrlBook === '5') {
        tour = {
          ...tour,
          price: 39,
          name: 'Krakow',
          file: 'krakow-9873419c.pdf',
        };
      }

      if (getPaymentUrlBook === '6') {
        tour = {
          ...tour,
          name: 'Krakow w jeden dzien',
          file: 'krakow-w-jeden-dzien-92c8001.pdf',
        };
      }

      const currencyCode = 'PLN';
      const language = 'pl';

      //     if (getPaymentUrlBook === '101') {
      //    //     currencyCode = 'USD';
      //         language = 'en';
      //         tour = {
      //             ...tour,
      //             price: 33,
      //             name: 'Krakow Guide',
      //             file: 'krakow-74991en.pdf',
      //         };
      //     }

      const iPLN = tour.price * 100;
      const name = `Przewodnik - ${tour.name}`;
      const notifyUrl = `https://lw5w20f910.execute-api.eu-west-1.amazonaws.com/default/zwiedzanie?notifyBook=${getPaymentUrlBook}`;
      const data = JSON.stringify({
        continueUrl: `https://zwiedzaniekrakowa.com/thanks?fid=${tour.file}`,
        notifyUrl,
        customerIp: event.headers['X-Forwarded-For'],
        merchantPosId: String(clientId),
        description: name,
        currencyCode,
        totalAmount: String(iPLN),
        // buyer: {
        //     email: buyerEmail,
        // },

        buyer: {
          email: '',
          language,
        },
        products: [
          {
            name,
            unitPrice: String(iPLN),
            quantity: '1',
          },
        ],
      });

      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/api/v2_1/orders/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${resJson.access_token}`,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resOrder = JSON.parse(body);
            const { redirectUri } = resOrder;
            const response = {
              statusCode: 301,
              headers: {
                Location: redirectUri,
              },
            };
            resolve(response);
          });
      });
      req.on('error', (error) => {
        console.error({
          error,
        });
      });
      req.write(data);
      req.end();
    });
  });
};

const getPaymentURLBookEn = async (event) => {
  return new Promise((resolve, reject) => {
    const tokenRequest = new Promise((resolve2, reject2) => {
      const data = `grant_type=client_credentials&client_id=${clientIdEn}&client_secret=${clientSecretEn}`;
      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/pl/standard/user/oauth/authorize',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resob = JSON.parse(body);
            resolve2(resob);
          });
      });
      req.on('error', (error) => {
        console.error(error);
      });
      req.write(data);
      req.end();
    });
    tokenRequest.then(async (resJson) => {
      const { getPaymentUrlBookEn } = event.queryStringParameters;

      //   console.log({getPaymentURLBookEn , event})
      let tour = {
        price: 9,
      };
      const currencyCode = 'PLN';
      let language = 'pl';

      if (getPaymentUrlBookEn === '101') {
        // currencyCode = 'USD';
        language = 'en';
        tour = {
          ...tour,
          price: 33,
          name: 'Krakow Guide Ebook',
          file: 'krakow-74991en.pdf',
        };
      }

      const iPLN = tour.price * 100;
      const name = `Guide - ${tour.name}`;
      const notifyUrl = `https://lw5w20f910.execute-api.eu-west-1.amazonaws.com/default/zwiedzanie?notifyBookEn=${getPaymentUrlBookEn}`;
      const data = JSON.stringify({
        continueUrl: `https://guideinkrakow.com/thanks_en?fid=${tour.file}`,
        notifyUrl,
        customerIp: event.headers['X-Forwarded-For'],
        merchantPosId: String(clientIdEn),
        description: name,
        currencyCode,
        totalAmount: String(iPLN),
        // buyer: {
        //     email: buyerEmail,
        // },

        buyer: {
          email: '',
          language,
        },
        products: [
          {
            name,
            unitPrice: String(iPLN),
            quantity: '1',
          },
        ],
      });

      const options = {
        hostname: 'secure.payu.com',
        port: 443,
        path: '/api/v2_1/orders/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${resJson.access_token}`,
        },
      };
      const req = https.request(options, (res) => {
        let body = [];
        res
          .on('data', (chunk) => {
            body.push(chunk);
          })
          .on('end', () => {
            body = Buffer.concat(body).toString();
            const resOrder = JSON.parse(body);
            const { redirectUri } = resOrder;
            const response = {
              statusCode: 301,
              headers: {
                Location: redirectUri,
              },
            };
            resolve(response);
          });
      });
      req.on('error', (error) => {
        console.error({
          error,
        });
      });
      req.write(data);
      req.end();
    });
  });
};

const notifyBook = async (event) => {
  const transporter = nodemailer.createTransport({
    SES: new AWS.SES({
      apiVersion: '2010-12-01',
      region: 'eu-west-1',
    }),
  });

  if (typeof event.body === 'string') {
    event.body = JSON.parse(event.body);
  }
  const { order } = event.body;
  if (!order) return;
  const { description, buyer, status } = order;
  if (status === 'COMPLETED') {
    const { email, firstName = '', lastName = '' } = buyer;

    let { notifyBook } = event.queryStringParameters;
    let link;
    let file;
    if (notifyBook === '1') {
      file = 'krakow-droga-krolewska-00c00df.pdf';
    }
    if (notifyBook === '2') {
      file = 'krakow-wzgorze-wawelskie-f88941d.pdf';
    }
    if (notifyBook === '3') {
      file = 'krakow-kazimierz-992g77cc.pdf';
    }
    if (notifyBook === '4') {
      file = 'krakow-kazimierz-ch-1004120d3.pdf';
    }
    if (notifyBook === '5') {
      file = 'krakow-9873419c.pdf';
    }
    if (notifyBook === '6') {
      file = 'krakow-w-jeden-dzien-92c8001.pdf';
    }

    link = `https://zwiedzaniekrakowa.com/thanks?fid=${file}`;

    const linkMobile = link.replace('.pdf', '-mobile.pdf');

    const htmlClient = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
Witam serdecznie!<br/><br/>

Dziękuję za zakup e-booka. Mam nadzieję, że będzie pomocny przy zwiedzaniu Krakowa :)
<br/><br/>
Można go pobrać tutaj:<br/>
<a href="${link}">${link}</a>
<br/><br/>

Pozdrawiam :)<br/>
Małgorzata Kasprowicz<br/>
501 962 037<br/>
<a href='https://zwiedzaniekrakowa.com'>https://zwiedzaniekrakowa.com</a>
</br></br>
          </body>
        </html>
    `;
    let emailParamsClient = {
      from: 'kontakt@zwiedzaniekrakowa.com',
      to: email,
      bcc: 'kontakt@zwiedzaniekrakowa.com',
      subject: `${description}`,
      html: htmlClient,
      attachments: [],
    };

    let html = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
          ${description}
          <br/><br/>
          Buyer:<br/><br/>
          ${email}<br/>
          ${firstName} ${lastName}
          <br/><br/>
          Email do wyslania:<br><br>

          ${htmlClient}

          </br></br>
          </body>
        </html>
      `;

    let emailParams = {
      from: 'kontakt@zwiedzaniekrakowa.com',
      to: 'kontakt@zwiedzaniekrakowa.com',
      bcc: '',
      subject: `wplacil - ${email} - PDF ${description}`,
      html,
      attachments: [],
    };

    if (notifyBook === '101') {
      file = 'krakow-74991en.pdf';
      link = `https://guideinkrakow.com/thanks?fid=${file}`;

      const htmlClient = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
Hello!<br/><br/>

Thank you for the purchase. Here's the link to the Krakow Guide ebook:<br/>
<a href="${link}">${link}</a>
<br/><br/>

Regards :)<br/>
Margaret Kasprowicz<br/>
+48 501 962 037<br/>
<a href='https://guideinkrakow.com'>https://guideinkrakow.com</a>
</br></br>
          </body>
        </html>
    `;
      emailParamsClient = {
        from: 'kontakt@zwiedzaniekrakowa.com',
        to: email,
        bcc: 'kontakt@zwiedzaniekrakowa.com',
        subject: `${description}`,
        html: htmlClient,
        attachments: [],
      };

      html = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
          ${description}
          <br/><br/>
          Buyer:<br/><br/>
          ${email}<br/>
          ${firstName} ${lastName}
          <br/><br/>
          Email do wyslania:<br><br>

          ${htmlClient}

          </br></br>
          </body>
        </html>
      `;

      emailParams = {
        from: 'kontakt@zwiedzaniekrakowa.com',
        to: 'kontakt@zwiedzaniekrakowa.com',
        bcc: '',
        subject: `wplacil - ${email} - PDF ${description}`,
        html,
        attachments: [],
      };
    }

    return new Promise((resolve, reject) => {
      transporter.sendMail(emailParamsClient, async (error, info) => {
        if (error) {
          console.error(error);
          //      return reject(error);
        }
        // console.log('transporter.sendMail result', info);

        transporter.sendMail(emailParams, async () => {
          resolve({
            statusCode: 200,
            isBase64Encoded: false,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              ok: 2,
            }),
          });
        });
      });
    });
  }

  return {
    statusCode: 200,
    isBase64Encoded: false,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      ok: 2,
    }),
  };
};

const notifyBookEn = async (event) => {
  const transporter = nodemailer.createTransport({
    SES: new AWS.SES({
      apiVersion: '2010-12-01',
      region: 'eu-west-1',
    }),
  });

  if (typeof event.body === 'string') {
    event.body = JSON.parse(event.body);
  }
  const { order } = event.body;
  if (!order) return;
  const { description, buyer, status } = order;
  if (status === 'COMPLETED') {
    const { email, firstName = '', lastName = '' } = buyer;

    let { notifyBookEn } = event.queryStringParameters;
    let link;
    let file;

    link = `https://guideinkrakow.com/thanks_en?fid=${file}`;
    const linkMobile = link.replace('.pdf', '-mobile.pdf');

    const htmlClient = `
    `;
    let emailParamsClient = {
      from: 'kontakt@zwiedzaniekrakowa.com',
      to: email,
      bcc: 'kontakt@zwiedzaniekrakowa.com',
      subject: `${description}`,
      html: htmlClient,
      attachments: [],
    };

    let html = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
          ${description}
          <br/><br/>
          Buyer:<br/><br/>
          ${email}<br/>
          ${firstName} ${lastName}
          <br/><br/>
          Email do wyslania:<br><br>

          ${htmlClient}

          </br></br>
          </body>
        </html>
      `;

    let emailParams = {
      from: 'kontakt@zwiedzaniekrakowa.com',
      to: 'kontakt@zwiedzaniekrakowa.com',
      bcc: '',
      subject: `wplacil - ${email} - PDF ${description}`,
      html,
      attachments: [],
    };

    if (notifyBookEn === '101') {
      file = 'krakow-74991en.pdf';
      link = `https://guideinkrakow.com/thanks_en?fid=${file}`;

      let htmlClient = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
Hello!<br/><br/>

Thank you for the purchase. Here's the link to the Krakow Guide ebook:<br/>
<a href="${link}">${link}</a>
<br/><br/>

Regards :)<br/>
Margaret Kasprowicz<br/>
+48 501 962 037<br/>
<a href='https://guideinkrakow.com'>https://guideinkrakow.com</a>
</br></br>
          </body>
        </html>
    `;
      emailParamsClient = {
        from: 'kontakt@zwiedzaniekrakowa.com',
        to: email,
        bcc: 'kontakt@zwiedzaniekrakowa.com',
        subject: `${description}`,
        html: htmlClient,
        attachments: [],
      };

      html = `
        <!DOCTYPE html>
        <meta charset="utf-8" />
        <html>
          <head></head>
          <body>
          ${description}
          <br/><br/>
          Buyer:<br/><br/>
          ${email}<br/>
          ${firstName} ${lastName}
          <br/><br/>
          Email do wyslania:<br><br>

          ${htmlClient}

          </br></br>
          </body>
        </html>
      `;

      emailParams = {
        from: 'kontakt@zwiedzaniekrakowa.com',
        to: 'kontakt@zwiedzaniekrakowa.com',
        bcc: '',
        subject: `wplacil - ${email} - PDF ${description}`,
        html,
        attachments: [],
      };
    }

    return new Promise((resolve, reject) => {
      transporter.sendMail(emailParamsClient, async (error, info) => {
        if (error) {
          console.error(error);
          //      return reject(error);
        }
        // console.log('transporter.sendMail result', info);

        transporter.sendMail(emailParams, async () => {
          resolve({
            statusCode: 200,
            isBase64Encoded: false,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              ok: 2,
            }),
          });
        });
      });
    });
  }

  return {
    statusCode: 200,
    isBase64Encoded: false,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      ok: 2,
    }),
  };
};

exports.handler = async (event) => {
  if (event.queryStringParameters.getPaymentUrlTour) {
    return await getPaymentURLTour(event);
  }
  if (event.queryStringParameters.getPaymentUrlTour3) {
    return await getPaymentURLTour3(event);
  }

  if (event.queryStringParameters.getPaymentUrlTour2) {
    return await getPaymentURLTour2(event);
  }

  if (event.queryStringParameters.notify) {
    return await notify(event);
  }

  if (event.queryStringParameters.getPaymentUrlBook) {
    return await getPaymentURLBook(event);
  }

  if (event.queryStringParameters.getPaymentUrlBookEn) {
    return await getPaymentURLBookEn(event);
  }

  if (event.queryStringParameters.notifyBook) {
    return await notifyBook(event);
  }
  if (event.queryStringParameters.notifyBookEn) {
    return await notifyBookEn(event);
  }

  if (!event.queryStringParameters.sendForm) {
    return {};
  }
};

*/
