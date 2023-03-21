# AWS Instance Using Terraform and Github Actions
### Setup Permissions Using CloudShell
Logon to [https://console.aws.amazon.com/](https://console.aws.amazon.com/).  
Check configuration:
```bash
aws configure set region eu-west-1
```

List configuration:
```bash
aws configure list
```

Create folder:
```bash
mkdir ~/setup_access
```

Move to folder:
```bash
cd ~/setup_access
```


Create nodejs package:
```bash
cat << 'EOF'  > package.json
{
  "name": "setup-access",
  "version": "1.0.0",
  "description": "Setup IAM roles and permissions for federated github authentication",
  "main": "setup_aws.js",
  "scripts": {
    "start": "node setup_aws.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "type": "module",
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@aws-sdk/client-iam": "^3.290.0",
    "@aws-sdk/client-s3": "^3.290.0"
  }
}
EOF

```


Create script to setup access:
```bash
cat << 'EOF' > setup_aws.js
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import {
    IAMClient,
    CreatePolicyCommand,
    CreateOpenIDConnectProviderCommand,
    CreateRoleCommand,
    AttachRolePolicyCommand,
    ListPoliciesCommand,
    ListOpenIDConnectProvidersCommand,
    UpdateAssumeRolePolicyCommand,
    GetRoleCommand
} from "@aws-sdk/client-iam";


const BUCKET_NAME = "github-tf-state-01";
const REGION = "eu-west-1";
const REPO_ACCESS_CONDITION = "repo:mpette200/aws-ec2-pub-01:*";
const TERRAFORM_ROLE = "github-tf-access-01-role";

const CLIENT_CONFIG = { region: REGION };


const createBucket = async () => {
    const client = new S3Client(CLIENT_CONFIG);
    const command = new CreateBucketCommand({
        Bucket: BUCKET_NAME,
        CreateBucketConfiguration: {
            LocationConstraint: REGION
        }
    });
    const response = await client.send(command);
    // A forward slash followed by the name of the bucket.
    return response.Location;
};


const getBucketPolicyArn = async() => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new ListPoliciesCommand({
        Scope: "Local"
    });
    try {
        const response = await client.send(command);
        const policy = response.Policies.find(x => x.PolicyName == `${BUCKET_NAME}-policy`);
        return policy.Arn;
    } catch (err) {
        console.log(err);
    }
};


const addBucketPolicy = async () => {
    const bucketPolicy = `{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "VisualEditor0",
                "Effect": "Allow",
                "Action": [
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:DeleteObject"
                ],
                "Resource": [
                    "arn:aws:s3:::${BUCKET_NAME}",
                    "arn:aws:s3:::${BUCKET_NAME}/*"
                ]
            }
        ]
    }`;

    const client = new IAMClient(CLIENT_CONFIG);
    const command = new CreatePolicyCommand({
        PolicyName: `${BUCKET_NAME}-policy`,
        PolicyDocument: bucketPolicy
    });
    try {
        const response = await client.send(command);
        return response.Policy.Arn;
    } catch (err) {
        console.log(err);
        return await getBucketPolicyArn();
    }
};


const getOIDCProviderArn = async () => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new ListOpenIDConnectProvidersCommand();
    try {
        const response = await client.send(command);
        const name = "token.actions.githubusercontent.com";
        const provider = response.OpenIDConnectProviderList.find(x => x.Arn.endsWith(name));
        return provider.Arn;
    } catch (err) {
        console.log(err);
    }
};


const createOIDCProvider = async () => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new CreateOpenIDConnectProviderCommand({
        Url: "https://token.actions.githubusercontent.com",
        ClientIDList: [
            "sts.amazonaws.com",
            "sts.amazonaws.com/tf-state"
        ],
        ThumbprintList: [
            "6938fd4d98bab03faadb97b34396831e3780aea1"
        ]
    });
    try {
        const response = await client.send(command);
        return response.OpenIDConnectProviderArn;
    } catch (err) {
        console.log(err);
        return await getOIDCProviderArn();
    }
};


const updateRole = async (roleName, trustDoc) => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new UpdateAssumeRolePolicyCommand({
        RoleName: roleName,
        PolicyDocument: trustDoc
    });
    try {
        await client.send(command);
    } catch (err) {
        console.log(err);
    }
};


const getRoleArn = async (roleName) => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new GetRoleCommand({
        RoleName: roleName
    });
    try {
        const response = await client.send(command);
        return response.Role.Arn;
    } catch (err) {
        console.log(err);
    }
};


const createOrUpdateBucketRole = async (oidcProviderArn) => {
    const trustDoc = `{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Federated": "${oidcProviderArn}"
                },
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringLike": {
                        "token.actions.githubusercontent.com:sub": "${REPO_ACCESS_CONDITION}"
                    },
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com/tf-state"
                    }
                }
            }
        ]
    }`;
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new CreateRoleCommand({
        RoleName: `${BUCKET_NAME}-role`,
        AssumeRolePolicyDocument: trustDoc
    });
    try {
        const response = await client.send(command);
        return response.Role.Arn;
    } catch (err) {
        console.log(err);
        console.log("Updating trust policy doc");
        await updateRole(`${BUCKET_NAME}-role`, trustDoc);
        return await getRoleArn(`${BUCKET_NAME}-role`);
    }
};


const attachBucketPolicyToRole = async (bucketPolicyArn) => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new AttachRolePolicyCommand({
        RoleName: `${BUCKET_NAME}-role`,
        PolicyArn: bucketPolicyArn
    });
    await client.send(command);
};


const createOrUpdateTerraformRole = async (oidcProviderArn) => {
    const trustDoc = `{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Federated": "${oidcProviderArn}"
                },
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringLike": {
                        "token.actions.githubusercontent.com:sub": "${REPO_ACCESS_CONDITION}"
                    },
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                    }
                }
            }
        ]
    }`;
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new CreateRoleCommand({
        RoleName: TERRAFORM_ROLE,
        AssumeRolePolicyDocument: trustDoc
    });
    try {
        const response = await client.send(command);
        return response.Role.Arn;
    } catch (err) {
        console.log(err);
        console.log("Updating trust policy doc");
        await updateRole(TERRAFORM_ROLE, trustDoc);
        return await getRoleArn(TERRAFORM_ROLE);
    }
};


const attachTerraformPolicyToRole = async () => {
    const client = new IAMClient(CLIENT_CONFIG);
    const command = new AttachRolePolicyCommand({
        RoleName: TERRAFORM_ROLE,
        PolicyArn: "arn:aws:iam::aws:policy/AmazonEC2FullAccess"
    });
    await client.send(command);
};


const main = async () => {
    const sep = "\n------";
    console.log(`Creating storage bucket: ${BUCKET_NAME}`);
    try {
        const bucketPath = await createBucket();
        console.log(`Created at path: ${bucketPath}`);
    } catch (err) {
        console.log(err);
    }
    
    console.log(sep);
    console.log(`Adding policy to bucket`);
    const bucketPolicyArn = await addBucketPolicy();
    console.log(`Bucket policy with arn: ${bucketPolicyArn}`);

    console.log(sep);
    console.log(`Adding OIDC provider`);
    const oidcProviderArn = await createOIDCProvider();
    console.log(`OIDC provider with arn: ${oidcProviderArn}`);

    console.log(sep);
    console.log(`Adding role for bucket`);
    const bucketRoleArn = await createOrUpdateBucketRole(oidcProviderArn);
    console.log(`Role with arn: ${bucketRoleArn}`);

    console.log(sep);
    console.log(`Attaching bucket policy to role`);
    try {
        await attachBucketPolicyToRole(bucketPolicyArn);
        console.log(`Attached policy`);
    } catch (err) {
        console.log(err);
    }

    console.log(sep);
    console.log(`Adding role for terraform`);
    const terraformRoleArn = await createOrUpdateTerraformRole(oidcProviderArn);
    console.log(`Role with arn: ${terraformRoleArn}`);

    console.log(sep);
    console.log(`Attaching terraform policy to role`);
    try {
        await attachTerraformPolicyToRole();
        console.log(`Attached policy`);
    } catch (err) {
        console.log(err);
    }
};

await main();
EOF

```


Install libraries
```bash
npm install
```

Run the script
```bash
npm start
```
