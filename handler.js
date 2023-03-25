'use strict';

const AWS = require('aws-sdk');
AWS.config.region = process.env.REGION;
const S3 = new AWS.S3();
const SSM = new AWS.SSM(); // jwt credentials
const axios = require('axios'); // api call
const sharp = require('sharp'); // photo resizing
const PassThrough = require('stream').PassThrough; // photo copying to s3

const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const WIDTHS = ['0', '100', '300', '500', '750', '1000', '1500', '2500'];

const ERRORS = {
  missingRequiredParams: 10,
  invalidParams: 20,
  invalidFormat: 30,
  missingAlbum: 40,
  missingWidth: 50,
  missingPhoto: 60,
  missingJwt: 70,
  resizeFailure: 200
}

module.exports.download = async (event) => {
  if (process.env.ENABLED === 'false') { return; }

  let params;
  try {
    params = await getParams(event);
  } catch(error) {
    return renderErrorPage([ERRORS[error]]);
  }

  const downloadInfo = await getResourceDownloadInfo(event, params);

  if (!downloadInfo.data || downloadInfo.data.length === 0 || (downloadInfo.data.errors && downloadInfo.data.errors == 'Missing resource')) {
    return renderErrorPage([ERRORS.missingPhoto]);
  }

  let resource = downloadInfo.data;
  const exists = await resourceExists({
    bucket: process.env.DOWNLOAD_BUCKET,
    key: resource.filename,
    version: resource.s3Version
  });

  if (!exists) {
    await resize(resource, params);
  }

  return await successResponse(resource);
};

async function resize(resource, params) {
  //try {
    const resourceMeta = parseContentType(resource.s3Key);
    const resourceReadStream = readStream({
      Bucket: resource.s3Bucket,
      Key: resource.s3Key,
      VersionId: resource.s3Version
    })
    const { resourceWriteStream, uploaded } = writeStream({
      Bucket: process.env.DOWNLOAD_BUCKET,
      Key: resource.filename
    });
    // If it is a pdf we can't resize it, so don't try.
    if (resourceMeta.format !== 'pdf') {
      const streamResize = sharp()
      .resize({
        width: params.width,
        height: params.width,
        fit: 'inside',
        withoutEnlargement: true
      })
      .withMetadata({
        exif: {
          IFD0: {
            Website: 'https://www.ravelpix.com',
            Copyright: 'Pangurbahn, Inc.',
            Artist: 'Pangurbahn, Inc.',
            Software: 'Adobe Photoshop'
          }
        }
      })
      .toFormat(resourceMeta.format)

      resourceReadStream
        .pipe(streamResize)
        .pipe(resourceWriteStream);
    } else {
      resourceReadStream
        .pipe(resourceWriteStream);
    }

    await uploaded
  // } catch(error) {
  //   sendEmail(`Resizing Error ${resource.id}::${resource.s3Key}::${ERRORS.resizeFailure}: ${size} ${error}`);
  //   return false;
  // }
}

function readStream({ Bucket, Key }) {
  return S3.getObject({ Bucket, Key }).createReadStream();
}

function writeStream({ Bucket, Key }) {
  const passThrough = new PassThrough();
  return {
    resourceWriteStream: passThrough,
    uploaded: S3.upload({
      ContentType: parseContentType(Key).contentType,
      Body: passThrough,
      Bucket,
      Key
    }).promise()
  };
}

async function sendEmail(message) {
  const parameter = await SSM.getParameter({
    Name: process.env.SSM_EMAIL_PARAM,
    WithDecryption: true 
  }).promise();

  const sendGridApiKey = parameter.Parameter.Value;
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(sendGridApiKey);

  const msg = {
    to: process.env.SUPPORT_EMAIL,
    from: process.env.SUPPORT_EMAIL,
    subject: 'Ravelpix Photo Download Error',
    text: message,
    html: message,
  };

  (async () => {
    try {
      await sgMail.send(msg);
    } catch (error) {
      if (error.response) { console.error(error.response.body); }
    }
  })();
}

// The photos do not use versioning. So there is no need to check the version or anything,
// we just need to know the photo exists
async function resourceExists({ bucket, key, version }) {
  return await S3.headObject({ Bucket: bucket, Key: key, VersionId: version })
    .promise()
    .then(
      response => true,
      () => false
    );
}

async function successResponse(resource) {
  const resourceMeta = parseContentType(resource.filename);
  try {
    const data = await S3.getObject({
      Bucket: process.env.DOWNLOAD_BUCKET,
      Key: resource.filename
    }).promise();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin' : '*',
        'Content-Type': resourceMeta.contentType,
        "Content-Disposition": `attachment; filename=${resource.filename}`
      },
      body: data.Body.toString('base64'),
      isBase64Encoded: true
    };
  } catch(error) {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin' : '*'
      },
      body: JSON.stringify({ error: 'Could not get file to download' }),
    };
  }
}

// Response:
// {
//   s3Bucket: string;
//   s3Version: string;
//   s3Key: string;
//   filename: string;
// }
async function getResourceDownloadInfo(event, params) {
  try {
    const parameter = await SSM.getParameter({ 
      Name: process.env.SSM_JWT_PARAM,
      WithDecryption: true 
    }).promise();
    const jwtToken = parameter.Parameter.Value;

    return await axios.get(
      `${process.env.API_ENDPOINT}/photos/${params.photoId}/download_file`,
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json'
        },
        params: { albumId: params.albumId, width: params.width }
      }
    );
  } catch(error) {
    return {};
  }
}

async function getParams(event) {
  if (!event.queryStringParameters.width) {
    throw new Error({ message: 'Missing width param' });
  }
  let width = event.queryStringParameters.width;
  if (WIDTHS.indexOf(width) < 0) { width = 1000; }
  width = parseInt(width, 10);

  let albumId;
  let photoId;
  if (event.queryStringParameters) {
    albumId = event.queryStringParameters.albumId;
    photoId = event.queryStringParameters.photoId;
  }
  if (!photoId) {
    throw new Error('missingPhoto');
  }
  if (!albumId) {
    throw new Error('missingAlbum');
  }

  let jwtToken = await getJwtToken();
  jwtToken = jwtToken.Parameter.Value;
  if (!jwtToken) {
    throw new Error('missingJwt');
  }

  return { width, albumId, photoId, jwtToken };
}

async function getJwtToken() {
  try {
    return await SSM.getParameter({ Name: process.env.SSM_JWT_PARAM, WithDecryption: true }).promise();
  } catch(error) {
    throw new Error({ message: `Could not get JWT token ${error}` });
  }
}

function parseContentType(key) {
  const typeMatch = key.match(/\.([^.]*)$/);
  if (!typeMatch) {
    throw new Error('invalidFormat', key)
  }
  let format = typeMatch[1].toLowerCase();
  if (ALLOWED_FORMATS.indexOf(format) === -1) {
    throw new Error('invalidFormat', format)
  }
  format = (format === 'jpg') ? 'jpeg' : format;
  let contentType;
  if (format === 'pdf') {
    contentType = 'application/pdf';
  } else {
    contentType = `image/${format}`;
  }
  return { contentType, format };
}

function renderErrorPage(errors) {
  return {
    statusCode: 400,
    headers: { 'Access-Control-Allow-Origin' : '*' },
    body: JSON.stringify({ errors }, null, 2),
  };
}


