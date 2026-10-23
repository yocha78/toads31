# AWS setup (one time)

This connects GitHub to a new AWS account so each deploy can create or update the Toads 31 back end. GitHub never holds an AWS password or key: AWS trusts this repository's `test` and `live` deploy jobs directly (OIDC).

It takes about 20 minutes. Do the steps in order.

## 1. Create the AWS account

1. Go to [aws.amazon.com](https://aws.amazon.com) and choose **Create an AWS Account**.
2. Use an email address you keep. Pick the **Basic (free)** support plan.
3. Once signed in as the root user, open your account name (top right) → **Security credentials** → **Assign MFA device**, and add an authenticator app. The root user can do anything, so this matters.

## 2. Set a budget alert

1. Search the top bar for **Budgets** and open **Billing and Cost Management → Budgets**.
2. **Create budget** → **Use a template (simplified)** → **Monthly cost budget**.
3. Name `toads31`, amount **5** (US dollars, about £4), and your email address.
4. **Create budget**. AWS emails you if spending heads past that. Expected cost is pennies a month.

## 3. Switch to the London region

In the top bar, next to your account name, choose **Europe (London) eu-west-2**. Keep it there for the next step.

## 4. Create the GitHub access role

1. Download the template: open [aws/github-deploy-role.yaml](../aws/github-deploy-role.yaml) on GitHub and use the **Download raw file** button.
2. In AWS, search for **CloudFormation** → **Create stack** → **With new resources (standard)**.
3. **Choose an existing template** → **Upload a template file** → pick the downloaded file → **Next**.
4. Stack name: `toads31-github-access`. Leave the parameters as they are (`CreateOidcProvider` = `yes`) → **Next** → **Next**.
5. At the bottom, tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names** → **Submit**.
6. Wait about a minute until the status reads **CREATE_COMPLETE** (refresh if needed).
7. Open the **Outputs** tab and copy the **RoleArn** value. It looks like `arn:aws:iam::123456789012:role/toads31-github-deploy`.

If step 5 fails with "Provider with url https://token.actions.githubusercontent.com already exists", delete the failed stack and start again with `CreateOidcProvider` = `no`.

## 5. Give GitHub the role

1. Open [Settings → Secrets and variables → Actions](https://github.com/yocha78/toads31/settings/secrets/actions) in the toads31 repository.
2. **New repository secret**: name `AWS_ROLE_ARN`, value the RoleArn you copied.

The RoleArn is not a password, but keeping it as a secret keeps it out of the logs.

## What happens next

The next deploy to `test` creates the AWS stack `toads31-test` (a database table, the API and a health check), writes its address into the app's `config.js`, and checks that `/health` answers. The first deploy to `main` creates the `toads31` stack in the same way, after your approval.

## Updating the role

If the template changes, update the stack instead of creating a new one: **CloudFormation → Stacks → `toads31-github-access` → Update → Replace existing template → Upload a template file**, pick the new file, then **Next** through the pages, tick the acknowledgement and **Submit**. The RoleArn stays the same.

## What the role can do

Only what deploying Toads 31 needs, in eu-west-2: manage the `toads31*` CloudFormation stacks, Lambda functions, DynamoDB tables, log groups and the IAM roles of those functions; API Gateway; the bucket SAM uses for uploads; and read `/toads31/*` parameters (the organiser password, later). Only the `test` and `live` deploy jobs of `yocha78/toads31` can use it.
