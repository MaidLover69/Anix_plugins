# Security Policy

## Supported versions

Only the newest version of each extension is supported. Anix updates extensions by itself when
**Settings › Plugins › Refresh** finds a new version, so check that you have it first.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately with GitHub's [Report a vulnerability](https://github.com/MaidLover69/Anix_plugins/security/advisories/new)
form (repository › **Security** › **Report a vulnerability**). Only the maintainer can see it.

Please include the extension and its version, what it does wrong, and how to reproduce it.
Do not include real account tokens, passwords or anyone's personal data.

## What happens next

This is a one-person project, so these are aims, not guarantees: a reply within **7 days**, and a
fixed extension version as soon as the problem is confirmed. You are credited in the extension's
changelog unless you would rather not be.

## Scope

**In scope**, for the extensions maintained here:

- an extension sending your data (search terms, history, settings) anywhere other than the site it reads from;
- an extension loading code from somewhere other than this repository's bundle;
- an extension giving a video or subtitle link that points somewhere harmful.

**Report to the Anix app instead** ([its security policy](https://github.com/MaidLover69/Anix/security/policy)):
anything that lets an extension break out of its sandbox, such as reading files, starting programs
or reaching private or local addresses. Those limits are enforced by the app, not by the extensions.

**Not in scope:**

- extensions listed by reference: report them to their authors;
- the streaming sites and video hosts themselves;
- requests to get around a site's anti-bot checks or region locks. That will not be added.
