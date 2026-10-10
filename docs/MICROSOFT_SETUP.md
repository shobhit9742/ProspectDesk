# Connect Microsoft through OAuth

The local app is ready for this connection. Use a separate Microsoft app registration for ProspectDesk.

1. In Microsoft Entra admin center, open **App registrations → New registration**. Choose organizational directories and personal Microsoft accounts if you want to test an Outlook.com account. Your tenant may restrict who can register applications.
2. Add a **Web** redirect URI exactly matching `http://127.0.0.1:4120/api/oauth/microsoft/callback`.
3. Under **API permissions**, add Microsoft Graph **delegated** permissions: `User.Read`, `Mail.ReadWrite`, and `Mail.Send`. The app also requests `offline_access` to refresh the connection. Follow your organization's consent requirements.
4. Create a client secret. Copy its **value**, not its identifier, into the ignored local `server/.env` file. Set `MICROSOFT_CLIENT_ID` to the application's client ID, `MICROSOFT_CLIENT_SECRET` to that value, and `MICROSOFT_TENANT=common` for the account types above. Keep credentials out of chat and source control.
5. Restart `npm run dev`, open **Connected inboxes**, select **Connect Microsoft**, and complete Microsoft's sign-in and consent flow.
6. Check the connected account, sync it, and inspect messages in **Unibox**. A real send requires an explicitly chosen recipient and send action. Provider acceptance does not prove recipient delivery or inbox placement.

The first live OAuth test is pending credentials. Automated tests currently cover mocked Graph contracts, including immutable message IDs, draft/send behavior, and message actions.

Official references: [Register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), and [Outlook immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
