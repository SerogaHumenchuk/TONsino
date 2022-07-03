import { gamePage } from "./gamePage";

export const connectWalletPage = () => {
    const rootElement = document.getElementById('root');
    const loginWrapperElement = document.createElement('div');
    loginWrapperElement.classList.add('loginWrapper');
    rootElement.append(loginWrapperElement);

    const loginButton = document.createElement('button');
    loginButton.textContent = 'Connect Wallet';
    loginButton.classList.add('connectWalletButton');
    loginWrapperElement.append(loginButton);

    const handleConnectWallet = () => {
        loginWrapperElement.remove();
        gamePage()
    };
    loginButton.addEventListener('click', handleConnectWallet)
}