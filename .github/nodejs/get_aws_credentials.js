module.exports = async ({core, audience, roleArn, sessionName}) => {
  
  const { Buffer } = require('node:buffer');
  const { STSClient, AssumeRoleWithWebIdentityCommand } = require("@aws-sdk/client-sts");

  const indentSpaces = 2;

  const id_token = await core.getIDToken(audience);
  const base64Payload = id_token.split('.')[1];
  const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
  const payloadData = JSON.stringify(payload, null, indentSpaces);

  console.log('Creating json web token with payload');
  console.log(payloadData);

  const client = new STSClient();
  const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      WebIdentityToken: id_token
  });

  const data = await client.send(command);
  console.log('Authenticated to role:');
  console.log(data.AssumedRoleUser);

  core.exportVariable('AWS_ACCESS_KEY_ID', data.Credentials.AccessKeyId);
  core.setSecret(data.Credentials.AccessKeyId);

  core.exportVariable('AWS_SECRET_ACCESS_KEY', data.Credentials.SecretAccessKey);
  core.setSecret(data.Credentials.SecretAccessKey);

  core.exportVariable('AWS_SESSION_TOKEN', data.Credentials.SessionToken);
  core.setSecret(data.Credentials.SessionToken);
};
