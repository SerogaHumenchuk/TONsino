import { roulette } from './roulette';

const renderGamesList = () => {
    const gamesListElement = document.createElement('ul');
    gamesListElement.classList.add('gamesList');
    const games = ['Poker', 'Blackjack', 'Roulette', 'Baccarat', 'Craps', 'Slots'];
    games.map(game => {
        const gameItemElement = document.createElement('li');
        gameItemElement.classList.add('gameItem');
        if(game === 'Roulette') gameItemElement.classList.add('rouletteGame');
        gameItemElement.textContent = game;
        gamesListElement.append(gameItemElement);
    })

    return gamesListElement
};


const renderFinishGameButton = () => {
    const finishGameBtnElement = document.createElement('button');
    finishGameBtnElement.textContent = 'Finish Game';
    finishGameBtnElement.classList.add('finishGameBtn');

    const handleFinishGame = () => {
        console.log('Game Finished')
    }

    finishGameBtnElement.addEventListener('click', handleFinishGame)

    return finishGameBtnElement;
}


export const gamePage = () => {
    const rootElement = document.getElementById('root');
    const headerElement = document.createElement('header');
    headerElement.classList.add('header');

    const gamesListElement = renderGamesList();
    headerElement.append(gamesListElement);

    const finishGameBtnElement = renderFinishGameButton()
    headerElement.append(finishGameBtnElement);


    rootElement.append(headerElement);
    roulette();
}