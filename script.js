const profileButton = document.getElementById("ProfilePic");
const accountControl = document.getElementById("AccountControl");
const accountMenu = document.getElementById("AccountMenu");
const accountNameForm = document.getElementById("AccountNameForm");
const accountNameInput = document.getElementById("AccountName");
const accountContinueButton = document.getElementById("AccountContinue");
const registrationForm = document.getElementById("AccountRegistrationForm");
const registrationPrompt = document.getElementById("RegistrationPrompt");
const fullNameInput = document.getElementById("FullName");
const emailInput = document.getElementById("AccountEmail");
const backToNameButton = document.getElementById("BackToName");
const accountDetails = document.getElementById("AccountDetails");
const signedInMessage = document.getElementById("SignedInMessage");
const signOutButton = document.getElementById("SignOutButton");
const accountStatus = document.getElementById("AccountStatus");
const accountStorageKey = "deloitte-bot-account";

let pendingName = "";
let currentAccount = readStoredAccount();

function readStoredAccount() {
    try {
        const storedAccount = JSON.parse(window.localStorage.getItem(accountStorageKey));
        if (typeof storedAccount?.name === "string" && typeof storedAccount?.fullName === "string") {
            return { name: storedAccount.name, fullName: storedAccount.fullName };
        }
    } catch { }

    return null;
}

function setStatus(message) {
    accountStatus.textContent = message;
}

function closeAccountMenu() {
    accountMenu.hidden = true;
    profileButton.setAttribute("aria-expanded", "false");
}

function renderAccount() {
    const signedIn = Boolean(currentAccount);
    accountNameForm.hidden = signedIn;
    registrationForm.hidden = true;
    accountDetails.hidden = !signedIn;
    profileButton.textContent = signedIn ? currentAccount.name : "Log in";
    profileButton.setAttribute("aria-label", signedIn ? `Account: ${currentAccount.name}` : "Log in");
    if (signedIn) {
        signedInMessage.textContent = `Signed in as ${currentAccount.fullName}`;
    }
}

function saveAccount(account) {
    currentAccount = { name: account.name, fullName: account.fullName };
    try {
        window.localStorage.setItem(accountStorageKey, JSON.stringify(currentAccount));
    } catch { }
    renderAccount();
}

function clearSavedAccount() {
    currentAccount = null;
    try {
        window.localStorage.removeItem(accountStorageKey);
    } catch { }
    renderAccount();
}

async function postAccountRequest(endpoint, payload) {
    let response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch {
        throw new Error("Cannot reach the account server. Check that it is running.");
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(result.error || "Account request failed.");
        error.status = response.status;
        throw error;
    }
    return result.account;
}

accountNameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    pendingName = accountNameInput.value.trim();
    if (!pendingName) {
        setStatus("Enter a name to continue.");
        return;
    }

    accountContinueButton.disabled = true;
    accountContinueButton.textContent = "Checking...";
    try {
        const account = await postAccountRequest("/api/accounts/sign-in", { name: pendingName });
        saveAccount(account);
        setStatus(`Welcome back, ${account.fullName}.`);
    } catch (error) {
        if (error.status === 404) {
            registrationPrompt.textContent = `No account named "${pendingName}" exists. Enter your details to add it to the server.`;
            accountNameForm.hidden = true;
            registrationForm.hidden = false;
            setStatus("");
            fullNameInput.focus();
        } else {
            setStatus(error.message);
        }
    } finally {
        accountContinueButton.disabled = false;
        accountContinueButton.textContent = "Continue";
    }
});

registrationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = registrationForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Creating...";
    try {
        const account = await postAccountRequest("/api/accounts/register", {
            name: pendingName,
            fullName: fullNameInput.value.trim(),
            email: emailInput.value.trim(),
        });
        saveAccount(account);
        setStatus(`Account created for ${account.fullName}.`);
    } catch (error) {
        if (error.status === 409) {
            registrationForm.hidden = true;
            accountNameForm.hidden = false;
            accountNameInput.value = pendingName;
            setStatus(error.message);
            accountNameInput.focus();
        } else {
            setStatus(error.message);
        }
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Create account";
    }
});

backToNameButton.addEventListener("click", () => {
    registrationForm.hidden = true;
    accountNameForm.hidden = false;
    setStatus("");
    accountNameInput.focus();
});

signOutButton.addEventListener("click", () => {
    clearSavedAccount();
    accountNameForm.reset();
    registrationForm.reset();
    pendingName = "";
    setStatus("Signed out.");
    accountMenu.hidden = false;
    profileButton.setAttribute("aria-expanded", "true");
    accountNameInput.focus();
});

profileButton.addEventListener("click", () => {
    const shouldOpen = accountMenu.hidden;
    accountMenu.hidden = !shouldOpen;
    profileButton.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen && !currentAccount) {
        accountNameInput.focus();
    }
});

document.addEventListener("click", (event) => {
    if (!accountControl.contains(event.target)) {
        closeAccountMenu();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !accountMenu.hidden) {
        closeAccountMenu();
        profileButton.focus();
    }
});

renderAccount();