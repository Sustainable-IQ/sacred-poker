'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Clock, Trophy, Eye, EyeOff, Crown } from 'lucide-react';

// Card and Game Types
interface Card {
  rank: string;
  suit: string;
  value: number;
}

interface Player {
  id: string;
  name: string;
  chips: number;
  hand: Card[];
  bet: number;
  folded: boolean;
  allIn: boolean;
  position: number;
  connected: boolean;
  hasActed: boolean;
  eliminated: boolean;
}

interface GameState {
  id: string;
  players: Player[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'tournament_complete';
  activePlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  mode: 'standard' | 'oracle' | 'silent' | 'ritual' | 'nobluff';
  winner?: Player;
  tournamentWinner?: Player;
  deck: Card[];
  deckIndex: number;
  bettingComplete: boolean;
  handNumber: number;
}

// Mock WebSocket for demo
class MockWebSocket {
  private listeners: { [event: string]: Function[] } = {};
  
  on(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event: string, data?: any) {
    setTimeout(() => {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => callback(data));
      }
    }, 100);
  }
}

// Poker Hand Evaluation (improved)
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];

function createDeck(): Card[] {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach((rank, index) => {
      deck.push({ rank, suit, value: index + 2 });
    });
  });
  return shuffleDeck(deck);
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function evaluateHand(cards: Card[]): { rank: number; name: string; kickers: number[]; highCard: number } {
  if (cards.length < 5) return { rank: 0, name: 'High Card', kickers: [], highCard: 0 };
  
  // Find best 5-card hand from 7 cards
  let bestHand: { rank: number; name: string; kickers: number[]; highCard: number } | null = null;
  
  // Generate all 5-card combinations
  for (let i = 0; i < cards.length - 4; i++) {
    for (let j = i + 1; j < cards.length - 3; j++) {
      for (let k = j + 1; k < cards.length - 2; k++) {
        for (let l = k + 1; l < cards.length - 1; l++) {
          for (let m = l + 1; m < cards.length; m++) {
            const hand = [cards[i], cards[j], cards[k], cards[l], cards[m]];
            const evaluation = evaluateFiveCardHand(hand);
            
            // Use compareHands function for proper comparison
            if (bestHand === null || compareHands(evaluation, bestHand) < 0) {
              bestHand = evaluation;
            }
          }
        }
      }
    }
  }
  
  return bestHand || { rank: 0, name: 'High Card', kickers: [], highCard: 0 };
}

function evaluateFiveCardHand(cards: Card[]): { rank: number; name: string; kickers: number[]; highCard: number } {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  
  // Count ranks
  const rankCounts: { [value: number]: number } = {};
  sorted.forEach(card => {
    rankCounts[card.value] = (rankCounts[card.value] || 0) + 1;
  });
  
  // Check for flush
  const suits = new Set(sorted.map(c => c.suit));
  const isFlush = suits.size === 1;
  
  // Check for straight
  const values = sorted.map(c => c.value);
  let isStraight = false;
  let straightHigh = 0;
  
  // Regular straight
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
    straightHigh = values[0];
  }
  
  // A-2-3-4-5 straight (wheel)
  if (!isStraight && values.includes(14) && values.includes(2) && 
      values.includes(3) && values.includes(4) && values.includes(5)) {
    isStraight = true;
    straightHigh = 5;
  }
  
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const pairs = Object.entries(rankCounts).filter(([_, count]) => count >= 2)
    .map(([value, _]) => parseInt(value)).sort((a, b) => b - a);
  
  const highCard = sorted[0].value;
  const kickers = sorted.map(c => c.value);
  
  // Hand rankings
  if (isStraight && isFlush) {
    if (straightHigh === 14) return { rank: 9, name: 'Royal Flush', kickers: [], highCard: 14 };
    return { rank: 8, name: 'Straight Flush', kickers: [straightHigh], highCard: straightHigh };
  }
  if (counts[0] === 4) {
    const quads = parseInt(Object.keys(rankCounts).find(k => rankCounts[parseInt(k)] === 4)!);
    return { rank: 7, name: 'Four of a Kind', kickers: [quads], highCard: quads };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    const trips = parseInt(Object.keys(rankCounts).find(k => rankCounts[parseInt(k)] === 3)!);
    const pair = parseInt(Object.keys(rankCounts).find(k => rankCounts[parseInt(k)] === 2)!);
    return { rank: 6, name: 'Full House', kickers: [trips, pair], highCard: trips };
  }
  if (isFlush) return { rank: 5, name: 'Flush', kickers, highCard };
  if (isStraight) return { rank: 4, name: 'Straight', kickers: [straightHigh], highCard: straightHigh };
  if (counts[0] === 3) {
    const trips = parseInt(Object.keys(rankCounts).find(k => rankCounts[parseInt(k)] === 3)!);
    return { rank: 3, name: 'Three of a Kind', kickers: [trips], highCard: trips };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    const highPair = Math.max(...pairs);
    const lowPair = Math.min(...pairs);
    return { rank: 2, name: 'Two Pair', kickers: [highPair, lowPair], highCard: highPair };
  }
  if (counts[0] === 2) {
    const pair = pairs[0];
    return { rank: 1, name: 'Pair', kickers: [pair], highCard: pair };
  }
  
  return { rank: 0, name: 'High Card', kickers, highCard };
}

function compareHands(hand1: any, hand2: any): number {
  if (hand1.rank !== hand2.rank) {
    return hand2.rank - hand1.rank; // Higher rank wins
  }
  
  // Same rank, compare kickers
  for (let i = 0; i < Math.max(hand1.kickers.length, hand2.kickers.length); i++) {
    const k1 = hand1.kickers[i] || 0;
    const k2 = hand2.kickers[i] || 0;
    if (k1 !== k2) {
      return k2 - k1;
    }
  }
  
  return 0; // Tie
}

// Game Logic
function initializeGame(playerNames: string[], mode: string): GameState {
  const players: Player[] = playerNames.map((name, index) => ({
    id: `player_${index}`,
    name,
    chips: 1000,
    hand: [],
    bet: 0,
    folded: false,
    allIn: false,
    position: index,
    connected: true,
    hasActed: false,
    eliminated: false
  }));

  const deck = createDeck();

  return {
    id: `game_${Date.now()}`,
    players,
    communityCards: [],
    pot: 0,
    currentBet: 0,
    phase: 'waiting',
    activePlayerIndex: 0,
    dealerIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    mode: mode as any,
    deck,
    deckIndex: 0,
    bettingComplete: false,
    handNumber: 1,
    tournamentWinner: undefined
  };
}

function checkForEliminations(game: GameState): GameState {
  const newGame = { ...game };
  let eliminationsThisHand = false;
  
  newGame.players = newGame.players.map(player => {
    if (player.chips === 0 && !player.eliminated) {
      eliminationsThisHand = true;
      return { ...player, eliminated: true };
    }
    return player;
  });
  
  return newGame;
}

function checkTournamentComplete(game: GameState): boolean {
  const activePlayers = game.players.filter(p => !p.eliminated);
  return activePlayers.length === 1;
}

function getNextDealerIndex(game: GameState): number {
  let nextDealer = (game.dealerIndex + 1) % game.players.length;
  let attempts = 0;
  
  while (attempts < game.players.length) {
    if (!game.players[nextDealer].eliminated) {
      return nextDealer;
    }
    nextDealer = (nextDealer + 1) % game.players.length;
    attempts++;
  }
  
  return game.dealerIndex;
}

function startNewHand(game: GameState): GameState {
  const gameWithEliminations = checkForEliminations(game);
  
  if (checkTournamentComplete(gameWithEliminations)) {
    const tournamentWinner = gameWithEliminations.players.find(p => !p.eliminated);
    return {
      ...gameWithEliminations,
      phase: 'tournament_complete',
      tournamentWinner,
      bettingComplete: true
    };
  }
  
  const newDealerIndex = getNextDealerIndex(gameWithEliminations);
  
  const newGame = {
    ...gameWithEliminations,
    dealerIndex: newDealerIndex,
    deck: createDeck(),
    deckIndex: 0,
    communityCards: [],
    pot: 0,
    currentBet: 0,
    winner: undefined,
    handNumber: gameWithEliminations.handNumber + 1
  };
  
  return dealCards(newGame);
}

function dealCards(game: GameState): GameState {
  const newGame = { ...game };
  
  newGame.players = newGame.players.map(player => ({
    ...player,
    hand: player.eliminated ? [] : [newGame.deck[newGame.deckIndex++], newGame.deck[newGame.deckIndex++]],
    folded: player.eliminated,
    bet: 0,
    hasActed: false,
    allIn: false
  }));

  const activePlayers = newGame.players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => !player.eliminated);
  
  if (activePlayers.length < 2) {
    return newGame;
  }
  
  const dealerPosition = activePlayers.findIndex(({ index }) => index === newGame.dealerIndex);
  const smallBlindIndex = activePlayers[(dealerPosition + 1) % activePlayers.length].index;
  const bigBlindIndex = activePlayers[(dealerPosition + 2) % activePlayers.length].index;
  
  const sbAmount = Math.min(newGame.smallBlind, newGame.players[smallBlindIndex].chips);
  const bbAmount = Math.min(newGame.bigBlind, newGame.players[bigBlindIndex].chips);
  
  newGame.players[smallBlindIndex].chips -= sbAmount;
  newGame.players[smallBlindIndex].bet = sbAmount;
  newGame.players[bigBlindIndex].chips -= bbAmount;
  newGame.players[bigBlindIndex].bet = bbAmount;
  
  if (newGame.players[smallBlindIndex].chips === 0) {
    newGame.players[smallBlindIndex].allIn = true;
  }
  if (newGame.players[bigBlindIndex].chips === 0) {
    newGame.players[bigBlindIndex].allIn = true;
  }
  
  newGame.players[smallBlindIndex].hasActed = false;
  newGame.players[bigBlindIndex].hasActed = true;

  newGame.pot = 0;

  return {
    ...newGame,
    phase: 'preflop',
    activePlayerIndex: activePlayers[(dealerPosition + 3) % activePlayers.length]?.index || activePlayers[0].index,
    currentBet: bbAmount,
    bettingComplete: false
  };
}

function isBettingComplete(game: GameState): boolean {
  const activePlayers = game.players.filter(p => !p.folded && !p.allIn && !p.eliminated);
  
  if (activePlayers.length <= 1) return true;
  
  const allActed = activePlayers.every(player => player.hasActed);
  const allMatchCurrentBet = activePlayers.every(player => 
    player.bet === game.currentBet || player.allIn
  );
  
  return allActed && allMatchCurrentBet;
}

function getNextActivePlayer(game: GameState): number {
  let nextIndex = (game.activePlayerIndex + 1) % game.players.length;
  let attempts = 0;
  
  while (attempts < game.players.length) {
    const player = game.players[nextIndex];
    if (!player.folded && !player.allIn && !player.eliminated) {
      return nextIndex;
    }
    nextIndex = (nextIndex + 1) % game.players.length;
    attempts++;
  }
  
  return game.activePlayerIndex;
}

// React Component
export default function SustainableIQPoker() {
  const [socket] = useState(() => new MockWebSocket());
  const [game, setGame] = useState<GameState | null>(null);
  const [playerName, setPlayerName] = useState<string>('');
  const [nameConfirmed, setNameConfirmed] = useState<boolean>(false);
  const [gameLog, setGameLog] = useState<string[]>([]);
  const [actionAmount, setActionAmount] = useState<number>(0);
  const [showCards, setShowCards] = useState<boolean>(false);

  const generatePlayerNames = (customName: string): string[] => {
    const genericNames = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
    const userPosition = Math.floor(Math.random() * 6);
    const allNames = [...genericNames];
    allNames.splice(userPosition, 0, customName);
    return allNames;
  };

  const addToLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    setGameLog(prev => [...prev.slice(-49), logEntry]);
  }, []);

  const startNewGame = (mode: string = 'standard') => {
    if (!playerName.trim()) return;
    
    const playerNames = generatePlayerNames(playerName);
    const newGame = initializeGame(playerNames, mode);
    const gameWithCards = dealCards(newGame);
    setGame(gameWithCards);
    addToLog(`Tournament started - Hand #${newGame.handNumber}`);
    addToLog(`Players: ${playerNames.join(', ')}`);
    addToLog(`Dealer: ${gameWithCards.players[newGame.dealerIndex].name}`);
    
    const activePlayers = gameWithCards.players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => !player.eliminated);
    const dealerPosition = activePlayers.findIndex(({ index }) => index === newGame.dealerIndex);
    const sbPlayer = activePlayers[(dealerPosition + 1) % activePlayers.length];
    const bbPlayer = activePlayers[(dealerPosition + 2) % activePlayers.length];
    
    addToLog(`${sbPlayer.player.name} posts small blind (${sbPlayer.player.bet})`);
    addToLog(`${bbPlayer.player.name} posts big blind (${bbPlayer.player.bet})`);
    addToLog(`First to act: ${gameWithCards.players[gameWithCards.activePlayerIndex].name}`);
  };

  const handlePlayerAction = (action: string, amount?: number) => {
    if (!game || !playerName) return;

    const playerIndex = game.players.findIndex(p => p.name === playerName);
    if (playerIndex !== game.activePlayerIndex) {
      addToLog(`It's not ${playerName}'s turn!`);
      return;
    }

    const player = game.players[playerIndex];
    const newGame = { ...game };
    
    switch (action) {
      case 'fold':
        newGame.players[playerIndex].folded = true;
        newGame.players[playerIndex].hasActed = true;
        addToLog(`${player.name} folds`);
        break;
        
      case 'call':
        const callAmount = Math.min(game.currentBet - player.bet, player.chips);
        newGame.players[playerIndex].chips -= callAmount;
        newGame.players[playerIndex].bet += callAmount;
        newGame.players[playerIndex].hasActed = true;
        if (callAmount === player.chips) {
          newGame.players[playerIndex].allIn = true;
          addToLog(`${player.name} calls ${callAmount} (ALL-IN)`);
        } else {
          addToLog(`${player.name} calls ${callAmount}`);
        }
        break;
        
      case 'raise':
        if (amount && amount > game.currentBet) {
          const totalBet = Math.min(amount, player.chips + player.bet);
          const additionalBet = totalBet - player.bet;
          newGame.players[playerIndex].chips -= additionalBet;
          newGame.players[playerIndex].bet = totalBet;
          newGame.players[playerIndex].hasActed = true;
          newGame.currentBet = totalBet;
          
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn && !p.eliminated) {
              p.hasActed = false;
            }
          });
          
          if (additionalBet === player.chips) {
            newGame.players[playerIndex].allIn = true;
            addToLog(`${player.name} raises to ${totalBet} (ALL-IN)`);
          } else {
            addToLog(`${player.name} raises to ${totalBet}`);
          }
        }
        break;
        
      case 'allin':
        const allInAmount = player.chips + player.bet;
        newGame.players[playerIndex].chips = 0;
        newGame.players[playerIndex].bet = allInAmount;
        newGame.players[playerIndex].allIn = true;
        newGame.players[playerIndex].hasActed = true;
        
        if (allInAmount > game.currentBet) {
          newGame.currentBet = allInAmount;
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn && !p.eliminated) {
              p.hasActed = false;
            }
          });
        }
        addToLog(`${player.name} goes all-in with ${allInAmount}`);
        break;
    }

    newGame.bettingComplete = isBettingComplete(newGame);
    
    if (!newGame.bettingComplete) {
      newGame.activePlayerIndex = getNextActivePlayer(newGame);
    }

    setGame(newGame);
    setActionAmount(newGame.currentBet + 10);
  };

  // ENHANCED AI DECISION FUNCTION WITH SUBTLE UNPREDICTABILITY
  const makeAIDecision = (player: Player, gameState: GameState): { action: string; amount?: number } => {
    const callAmount = gameState.currentBet - player.bet;
    const currentPot = gameState.pot + gameState.players.reduce((sum, p) => sum + p.bet, 0);
    const averageBet = currentPot / Math.max(1, gameState.players.filter(p => !p.folded && !p.eliminated).length);
    const estimatedRaises = Math.floor(averageBet / gameState.bigBlind);
    
    const [card1, card2] = player.hand;
    let handStrength = 0;
    
    // STANDARD HAND EVALUATION (unchanged)
    if (card1.value === card2.value) {
      if (card1.value >= 10) handStrength = 95;
      else if (card1.value >= 7) handStrength = 80;
      else handStrength = 65;
    }
    else if (card1.value >= 14 || card2.value >= 14) {
      if ((card1.value >= 13 && card2.value >= 13)) {
        handStrength = card1.suit === card2.suit ? 90 : 85;
      } else if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 80 : 70;
      } else if ((card1.value >= 9 && card2.value >= 9)) {
        handStrength = card1.suit === card2.suit ? 65 : 50;
      } else {
        handStrength = card1.suit === card2.suit ? 45 : 30;
      }
    }
    else if (card1.value >= 13 || card2.value >= 13) {
      if ((card1.value >= 12 && card2.value >= 12)) {
        handStrength = card1.suit === card2.suit ? 75 : 65;
      } else if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 70 : 55;
      } else if ((card1.value >= 10 && card2.value >= 10)) {
        handStrength = card1.suit === card2.suit ? 60 : 45;
      } else {
        handStrength = card1.suit === card2.suit ? 40 : 25;
      }
    }
    else if (card1.value >= 11 || card2.value >= 11) {
      if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 65 : 50;
      } else if ((card1.value >= 10 && card2.value >= 10)) {
        handStrength = card1.suit === card2.suit ? 55 : 40;
      } else {
        handStrength = card1.suit === card2.suit ? 35 : 20;
      }
    }
    else if (card1.suit === card2.suit && Math.abs(card1.value - card2.value) <= 1) {
      handStrength = Math.max(card1.value, card2.value) * 4;
    }
    else if (Math.abs(card1.value - card2.value) <= 1) {
      handStrength = Math.max(card1.value, card2.value) * 2.5;
    }
    else {
      handStrength = Math.max(card1.value, card2.value);
    }

    // Post-flop adjustment
    if (gameState.communityCards.length > 0) {
      const handEval = evaluateHand([...player.hand, ...gameState.communityCards]);
      handStrength = handEval.rank * 15 + (handEval.highCard / 14) * 10 + 50;
    }

    // SUBTLE UNPREDICTABILITY ENHANCEMENTS
    // Create unique seed for this player this hand to ensure consistency within hand
    const playerSeed = (player.id.charCodeAt(player.id.length - 1) + gameState.handNumber) % 1000;
    
    // 1. MICRO-VARIANCE: Tiny random adjustments (±3%)
    const microVariance = ((playerSeed % 7) - 3) / 100; // -3% to +3%
    const adjustedHandStrength = handStrength * (1 + microVariance);
    
    // 2. OCCASIONAL QUIRKS: Very rare single-hand anomalies
    const quirkChance = (playerSeed % 127) / 127; // 0 to 1, but deterministic per player/hand
    
    // 3. POSITION-BASED MICRO-ADJUSTMENTS
    const activePlayers = gameState.players.filter(p => !p.eliminated);
    const playerPosition = activePlayers.findIndex(p => p.id === player.id);
    const latePosition = playerPosition >= activePlayers.length - 2;
    
    // Standard decision logic with subtle modifications
    const potOdds = callAmount > 0 ? callAmount / (currentPot + callAmount) : 0;
    const betSize = callAmount / Math.max(1, player.chips);
    
    let aggressionFactor = 1.0;
    if (estimatedRaises >= 3) {
      aggressionFactor = 0.3;
    } else if (estimatedRaises >= 2) {
      aggressionFactor = 0.6;
    }
    
    if (betSize > 0.3) {
      aggressionFactor *= 0.5;
    }
    
    // SUBTLE ENHANCEMENTS START HERE
    
    // 4. RARE UNEXPECTED FOLD (0.7% chance with premium hands)
    if (adjustedHandStrength >= 85 && quirkChance < 0.007 && callAmount > 0) {
      return { action: 'fold' }; // Occasionally fold AA/KK to confuse
    }
    
    // 5. TINY OVERBET WITH STRONG HANDS (1.2% chance)
    if (adjustedHandStrength >= 80 && quirkChance > 0.988 && callAmount === 0) {
      const overbet = Math.floor(currentPot * 1.4);
      if (overbet <= player.chips + player.bet) {
        return { action: 'raise', amount: gameState.currentBet + overbet };
      }
    }
    
    // 6. RARE WEAK HAND BLUFF (0.8% chance in late position)
    if (latePosition && adjustedHandStrength < 25 && quirkChance < 0.008 && callAmount === 0) {
      const bluffSize = Math.floor(currentPot * 0.6);
      if (bluffSize <= player.chips + player.bet) {
        return { action: 'raise', amount: gameState.currentBet + bluffSize };
      }
    }
    
    // 7. OCCASIONAL LIMP WITH STRONG HANDS (1.5% chance pre-flop)
    if (gameState.phase === 'preflop' && adjustedHandStrength >= 85 && quirkChance > 0.985 && callAmount === gameState.bigBlind - player.bet) {
      return { action: 'call' }; // Limp with AA/KK sometimes
    }
    
    // STANDARD DECISION LOGIC (with micro-adjustments)
    
    // Premium hands
    if (adjustedHandStrength >= 85) {
      const raiseThreshold = 0.85 * aggressionFactor;
      if (Math.random() < raiseThreshold) {
        const raiseAmount = Math.floor(Math.min(
          gameState.currentBet + Math.max(gameState.bigBlind * 2, currentPot * 0.3),
          player.chips + player.bet
        ));
        return { action: 'raise', amount: raiseAmount };
      }
      return { action: 'call' };
    }
    
    // Strong hands
    if (adjustedHandStrength >= 70) {
      if (betSize < 0.1 || Math.random() < (0.8 * aggressionFactor)) {
        if (Math.random() < (0.3 * aggressionFactor)) {
          const raiseAmount = Math.floor(Math.min(
            gameState.currentBet + gameState.bigBlind * 2, 
            player.chips + player.bet
          ));
          return { action: 'raise', amount: raiseAmount };
        }
        return { action: 'call' };
      }
    }
    
    // Decent hands
    if (adjustedHandStrength >= 50) {
      if (potOdds < 0.3 || betSize < 0.05) {
        return { action: 'call' };
      }
    }
    
    // Marginal hands
    if (adjustedHandStrength >= 30) {
      if (potOdds < 0.15 || betSize < 0.02) {
        return { action: 'call' };
      }
    }
    
    // Free play
    if (callAmount === 0) return { action: 'call' };
    
    return { action: 'fold' };
  };

  const executeAIAction = (gameState: GameState): GameState => {
    const activePlayer = gameState.players[gameState.activePlayerIndex];
    const decision = makeAIDecision(activePlayer, gameState);
    
    const newGame = { ...gameState };
    const playerIndex = gameState.activePlayerIndex;
    
    switch (decision.action) {
      case 'fold':
        newGame.players[playerIndex].folded = true;
        newGame.players[playerIndex].hasActed = true;
        addToLog(`${activePlayer.name} folds`);
        break;
        
      case 'call':
        const callAmount = Math.min(gameState.currentBet - activePlayer.bet, activePlayer.chips);
        newGame.players[playerIndex].chips -= callAmount;
        newGame.players[playerIndex].bet += callAmount;
        newGame.players[playerIndex].hasActed = true;
        if (callAmount === activePlayer.chips) {
          newGame.players[playerIndex].allIn = true;
          addToLog(`${activePlayer.name} calls ${callAmount} (ALL-IN)`);
        } else if (callAmount === 0) {
          addToLog(`${activePlayer.name} checks`);
        } else {
          addToLog(`${activePlayer.name} calls ${callAmount}`);
        }
        break;
        
      case 'raise':
        if (decision.amount && decision.amount > gameState.currentBet) {
          const totalBet = Math.floor(Math.min(decision.amount, activePlayer.chips + activePlayer.bet));
          const additionalBet = totalBet - activePlayer.bet;
          newGame.players[playerIndex].chips -= additionalBet;
          newGame.players[playerIndex].bet = totalBet;
          newGame.players[playerIndex].hasActed = true;
          newGame.currentBet = totalBet;
          
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn && !p.eliminated) {
              p.hasActed = false;
            }
          });
          
          if (additionalBet === activePlayer.chips) {
            newGame.players[playerIndex].allIn = true;
            addToLog(`${activePlayer.name} raises to ${totalBet} (ALL-IN)`);
          } else {
            addToLog(`${activePlayer.name} raises to ${totalBet}`);
          }
        }
        break;
    }

    newGame.bettingComplete = isBettingComplete(newGame);
    
    if (newGame.bettingComplete) {
      const activePlayers = newGame.players.filter(p => !p.folded && !p.eliminated);
      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        const totalBets = newGame.players.reduce((sum, p) => sum + p.bet, 0);
        const winAmount = newGame.pot + totalBets;
        
        winner.chips += winAmount;
        newGame.winner = winner;
        newGame.pot = winAmount;
        newGame.phase = 'showdown';
        newGame.bettingComplete = true;
        newGame.currentBet = 0;
        
        newGame.players.forEach(p => p.bet = 0);
        
        addToLog(`${winner.name} wins ${winAmount} (everyone else folded)`);
        return newGame;
      }
    }
    
    if (!newGame.bettingComplete) {
      newGame.activePlayerIndex = getNextActivePlayer(newGame);
    }

    return newGame;
  };

  // Auto-play AI players
  useEffect(() => {
    if (!game) return;
    
    const activePlayer = game.players[game.activePlayerIndex];
    
    if ((game as GameState).phase === 'showdown' || (game as GameState).phase === 'tournament_complete' || game.bettingComplete || game.winner) {
      return;
    }
    
    if (
      game.bettingComplete &&
      (game as GameState).phase !== 'showdown' &&
      (game as GameState).phase !== 'tournament_complete' &&
      !game.winner
    ) {
      setTimeout(() => advancePhase(), 1000);
      return;
    }
    
    const isHumanPlayer = activePlayer.name === playerName;
    
    if (!isHumanPlayer && !activePlayer.folded && !activePlayer.allIn && !activePlayer.eliminated && !activePlayer.hasActed) {
      const timer = setTimeout(() => {
        setGame(prevGame => {
          if (!prevGame || (prevGame as GameState).phase === 'showdown' || (prevGame as GameState).phase === 'tournament_complete' || prevGame.bettingComplete || prevGame.winner) {
            return prevGame;
          }
          
          const currentActivePlayer = prevGame.players[prevGame.activePlayerIndex];
          if (currentActivePlayer.hasActed || currentActivePlayer.folded || currentActivePlayer.allIn || currentActivePlayer.eliminated || currentActivePlayer.name === playerName) {
            return prevGame;
          }
          
          return executeAIAction(prevGame);
        });
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [game?.activePlayerIndex, game?.phase, game?.bettingComplete, game?.winner, playerName]);

  const advancePhase = () => {
    if (!game) return;
    
    if (!game.bettingComplete && (game as GameState).phase !== 'showdown') {
      addToLog("Betting round must be completed first!");
      return;
    }

    const newGame = { ...game };
    
    const totalBets = newGame.players.reduce((sum, player) => sum + player.bet, 0);
    newGame.pot += totalBets;
    newGame.players.forEach(player => {
      player.bet = 0;
      player.hasActed = false;
    });
    newGame.currentBet = 0;
    newGame.bettingComplete = false;

    switch ((game as GameState).phase) {
      case 'preflop':
        newGame.communityCards = [
          newGame.deck[newGame.deckIndex++],
          newGame.deck[newGame.deckIndex++],
          newGame.deck[newGame.deckIndex++]
        ];
        newGame.phase = 'flop';
        addToLog('Flop dealt');
        break;
        
      case 'flop':
        newGame.communityCards.push(newGame.deck[newGame.deckIndex++]);
        newGame.phase = 'turn';
        addToLog('Turn dealt');
        break;
        
      case 'turn':
        newGame.communityCards.push(newGame.deck[newGame.deckIndex++]);
        newGame.phase = 'river';
        addToLog('River dealt');
        break;
        
      case 'river':
        newGame.phase = 'showdown';
        const activePlayers = newGame.players.filter(p => !p.folded && !p.eliminated);
        
        if (activePlayers.length === 1) {
          newGame.winner = activePlayers[0];
          newGame.winner.chips += newGame.pot;
          addToLog(`${newGame.winner.name} wins ${newGame.pot} (everyone else folded)`);
        } else {
          const handEvaluations = activePlayers.map(player => ({
            player,
            hand: evaluateHand([...player.hand, ...newGame.communityCards])
          }));
          
          handEvaluations.sort((a, b) => compareHands(a.hand, b.hand));
          
          const winner = handEvaluations[0];
          const second = handEvaluations[1];
          
          if (second && compareHands(winner.hand, second.hand) === 0) {
            const tiedPlayers = handEvaluations.filter(
              h => compareHands(h.hand, winner.hand) === 0
            ).map(h => h.player);
            
            const splitAmount = Math.floor(newGame.pot / tiedPlayers.length);
            tiedPlayers.forEach(p => p.chips += splitAmount);
            
            newGame.pot = 0;
            newGame.winner = undefined;
            addToLog(`Split pot! ${tiedPlayers.map(p => p.name).join(' & ')} each win ${splitAmount} with ${winner.hand.name}`);
            
            handEvaluations.forEach(({ player, hand }) => {
              addToLog(`${player.name}: ${hand.name} (${player.hand.map(c => c.rank + c.suit).join(', ')})`);
            });
          } else {
            newGame.winner = winner.player;
            newGame.winner.chips += newGame.pot;
            addToLog(`${winner.player.name} wins ${newGame.pot} with ${winner.hand.name}`);
            
            handEvaluations.forEach(({ player, hand }) => {
              addToLog(`${player.name}: ${hand.name} (${player.hand.map(c => c.rank + c.suit).join(', ')})`);
            });
          }
        }
        newGame.bettingComplete = true;
        break;
    }

    if ((newGame as GameState).phase !== 'showdown') {
      const activePlayers = newGame.players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => !player.eliminated);
      const dealerPosition = activePlayers.findIndex(({ index }) => index === newGame.dealerIndex);
      newGame.activePlayerIndex = activePlayers[(dealerPosition + 1) % activePlayers.length]?.index || activePlayers[0].index;
      
      while (newGame.players[newGame.activePlayerIndex].folded || newGame.players[newGame.activePlayerIndex].eliminated) {
        newGame.activePlayerIndex = getNextActivePlayer(newGame);
      }
    }
    
    setGame(newGame);
  };

  const nextHand = () => {
    if (!game) return;
    
    const newGame = startNewHand(game);
    setGame(newGame);
    
    if (newGame.phase === 'tournament_complete') {
      addToLog(`🏆 TOURNAMENT COMPLETE! ${newGame.tournamentWinner?.name} wins the tournament!`);
    } else {
      addToLog(`--- Hand #${newGame.handNumber} ---`);
      addToLog(`Dealer: ${newGame.players[newGame.dealerIndex].name}`);
      
      const newlyEliminated = newGame.players.filter(p => p.eliminated && p.chips === 0);
      newlyEliminated.forEach(p => {
        addToLog(`💀 ${p.name} has been eliminated from the tournament`);
      });
      
      const activePlayers = newGame.players.map((p, i) => ({ player: p, index: i })).filter(({ player }) => !player.eliminated);
      const dealerPosition = activePlayers.findIndex(({ index }) => index === newGame.dealerIndex);
      const sbPlayer = activePlayers[(dealerPosition + 1) % activePlayers.length];
      const bbPlayer = activePlayers[(dealerPosition + 2) % activePlayers.length];
      
      addToLog(`${sbPlayer.player.name} posts small blind (${sbPlayer.player.bet})`);
      addToLog(`${bbPlayer.player.name} posts big blind (${bbPlayer.player.bet})`);
      addToLog(`First to act: ${newGame.players[newGame.activePlayerIndex].name}`);
    }
  };

  const getSuitIcon = (suit: string) => {
    const style = suit === '♥' || suit === '♦' ? 'text-red-500' : 'text-black';
    return <span className={`text-lg ${style}`}>{suit}</span>;
  };

  const CardComponent = ({ card, hidden = false }: { card: Card; hidden?: boolean }) => (
    <div className="bg-white border-2 border-gray-300 rounded-lg w-12 h-16 flex flex-col items-center justify-center text-sm font-bold shadow-md">
      {hidden ? (
        <div className="text-blue-600">?</div>
      ) : (
        <>
          <div className={card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-black'}>
            {card.rank}
          </div>
          {getSuitIcon(card.suit)}
        </>
      )}
    </div>
  );

  const PlayerCard = ({ player, index, game, playerName, showCards }: { 
    player: Player; 
    index: number; 
    game: GameState; 
    playerName: string;
    showCards: boolean;
  }) => (
    <div
      className={`p-3 rounded-lg shadow-lg border-2 w-48 ${
        player.eliminated
          ? 'bg-gray-300 border-gray-500 opacity-60'
          : player.folded
          ? 'bg-gray-200 border-gray-400'
          : game.activePlayerIndex === index
          ? 'bg-yellow-100 border-yellow-500'
          : player.name === playerName
          ? 'bg-blue-100 border-blue-500'
          : 'bg-white border-gray-300'
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <h3 style={{color: '#000000', fontWeight: 'bold', fontSize: '1rem'}}>
          {player.name}
          {player.eliminated && <span className="text-red-600 ml-2">💀</span>}
        </h3>
        <div className="flex gap-1">
          {index === game.dealerIndex && !player.eliminated && (
            <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">D</div>
          )}
          {game.activePlayerIndex === index && !player.folded && !player.eliminated && (
            <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">TURN</div>
          )}
          {game.phase === 'tournament_complete' && game.tournamentWinner?.name === player.name && (
            <div className="bg-yellow-500 text-black px-2 py-1 rounded text-xs font-bold flex items-center gap-1">
              <Crown className="w-3 h-3" />
              WINNER
            </div>
          )}
        </div>
      </div>
      
      <div className="space-y-1 text-xs" style={{ color: player.eliminated ? '#666' : '#000' }}>
        <p>Chips: ${player.chips}</p>
        <p>Bet: ${player.bet}</p>
        <p>Status: {
          player.eliminated ? 'Eliminated' : 
          player.folded ? 'Folded' : 
          player.allIn ? 'All-In' : 
          'Active'
        }</p>
        {!player.eliminated && <p>Action: {player.hasActed ? '✓' : '⏳'}</p>}
      </div>

      <div className="mt-2">
        <div className="flex gap-1 justify-center">
          {player.hand.map((card, cardIndex) => (
            <div key={cardIndex} className="transform scale-75">
              <CardComponent
                card={card}
                hidden={player.name !== playerName && !showCards}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (!nameConfirmed) {
    return (
      <div className="min-h-screen p-8" style={{
        background: `
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0),
          radial-gradient(ellipse at center, #2d5016 0%, #1f3710 60%, #0f1f08 100%)
        `,
        backgroundSize: '25px 25px, 100% 100%'
      }}>
        <div className="max-w-md mx-auto mt-20">
          <div className="bg-white rounded-xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-black mb-2">♠ Poker Tournament ♣</h1>
              <p className="text-gray-600">Enter your player name to join the table</p>
            </div>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Enter your name..."
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none text-black bg-white text-lg"
                style={{ color: '#000000', backgroundColor: '#ffffff' }}
                maxLength={20}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && playerName.trim().length >= 2) {
                    setNameConfirmed(true);
                  }
                }}
              />
              
              <button
                onClick={() => setNameConfirmed(true)}
                disabled={playerName.trim().length < 2}
                className={`w-full py-3 rounded-lg font-semibold text-lg transition-colors ${
                  playerName.trim().length >= 2
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
              
              {playerName.trim().length > 0 && playerName.trim().length < 2 && (
                <p className="text-red-500 text-sm text-center">Name must be at least 2 characters</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen p-8" style={{
        background: `
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0),
          radial-gradient(ellipse at center, #2d5016 0%, #1f3710 60%, #0f1f08 100%)
        `,
        backgroundSize: '25px 25px, 100% 100%'
      }}>
        <div className="max-w-4xl mx-auto space-y-6">
          
          <div className="max-w-md mx-auto bg-white rounded-xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-black mb-2">♠ Welcome, {playerName}! ♣</h1>
              <p className="text-green-600 font-bold">Ready to join the tournament?</p>
            </div>
            
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-black mb-2">Tournament Format:</h3>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 6 players total (you + 5 AI players)</li>
                  <li>• Everyone starts with $1,000 chips</li>
                  <li>• Blinds: $10/$20</li>
                  <li>• Last player standing wins!</li>
                </ul>
              </div>
              
              <button
                onClick={() => startNewGame('standard')}
                className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold text-lg"
              >
                Start Tournament
              </button>
              
              <button
                onClick={() => {
                  setNameConfirmed(false);
                  setPlayerName('');
                }}
                className="w-full bg-gray-500 text-white py-2 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Change Name
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
              ♠ About This Vibe Coded Tournament ♣
            </h2>
            
            <div className="prose prose-sm max-w-none text-gray-700 space-y-4">
              <p>
                This online poker tournament wasn't built to rival the world's top poker platforms — it was built as a <em>vibe coding experiment</em>. The goal? To explore how Large Language Models (LLMs) like GPT can be used in creative software development, blending AI decision logic with classic game mechanics. Also because I can't find an honest online poker game out there; if I can build my own, then I know it is honest. That way, I can practice in a safespace. The next step, it to call a LLM to make better logic decisions.
              </p>

              <p>
                <strong>Tournament Format:</strong> Players start with $1000 chips. Play continues hand after hand until only one player remains. When your chips reach zero, you're eliminated from the tournament. Last player standing wins!
              </p>

              <p>
                THIS GAME MIGHT STILL CONTAIN BUGS - IT IS A WORK IN PROGRESS. For more Info sustainableiq-at-gmail-dot-com
              </p>

              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Tech Stack (V2 Build - Tournament Mode)</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Frontend:</strong> React (with TailwindCSS styling)</li>
                  <li><strong>Runtime:</strong> Next.js (served locally on <code className="bg-gray-100 px-1 rounded">http://localhost:3000</code>)</li>
                  <li><strong>Development Environment:</strong> Visual Studio Code running on a local PC</li>
                  <li><strong>Logic & AI:</strong> TypeScript + Python-inspired patterns + experimental GPT decision hooks</li>
                  <li><strong>State:</strong> In-memory game logic with mock WebSocket simulation</li>
                  <li><strong>AI Behavior:</strong> Scripted poker logic with a placeholder for future LLM integration</li>
                  <li><strong>Tournament Logic:</strong> Multi-hand progression, elimination tracking, dealer rotation</li>
                </ul>
              </div>

              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">But here's the real miracle:</h3>
                <p className="text-blue-700 text-sm">
                  This entire tournament system, including hand progression, elimination logic, dealer rotation, and tournament completion detection, was built by someone with zero formal background in computer science or software engineering. Not a single programming or CS course. Just a regular person with strong pattern recognition, a love for systems thinking, and a commitment to vibe coding with AI.
                </p>
                <p className="text-blue-700 mt-2 text-sm">
                  This project is a living proof that we've entered a new era: Where deep curiosity, clean intuition, and aligned tools can carry you further than credentials ever could.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
              ♠ Tournament Poker Experience ♣
            </h2>
            
            <div className="prose prose-sm max-w-none text-gray-700 space-y-4">
              <p>
                This is the World's Most Honest Online Poker. The shuffleDeck function performs a Fisher-Yates shuffle, which is widely used and statistically fair — if the random number generator (RNG) is strong. You'll be seated at a table with 5 AI opponents. Your position and the dealer button will rotate each hand, 
                just like in real poker. Play smart, manage your bankroll, and outlast your opponents to claim victory!
              </p>

              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">How to Play:</h3>
                <ul className="text-blue-700 text-sm space-y-1">
                  <li>• When it's your turn, choose to Fold, Call, Raise, or go All-In</li>
                  <li>• Watch your chip count - when you hit $0, you're eliminated</li>
                  <li>• The dealer button rotates clockwise each hand</li>
                  <li>• Use the "Show/Hide Cards" button to peek at opponents' hands</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPlayerData = game?.players.find(p => p.name === playerName);
  const isMyTurn = currentPlayerData && game?.players[game.activePlayerIndex]?.name === playerName && !currentPlayerData.eliminated;

  return (
    <div className="min-h-screen p-4" style={{
      background: `
        radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0),
        radial-gradient(ellipse at center, #2d5016 0%, #1f3710 60%, #0f1f08 100%)
      `,
      backgroundSize: '25px 25px, 100% 100%'
    }}>
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-white mb-2">♠ The World's Most Honest Online Poker Tournament ♣</h1>
          <div className="flex justify-center items-center gap-4 text-white">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span>Hand #{game?.handNumber || 1}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              <span>Phase: {game?.phase.toUpperCase() || 'WAITING'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              <span>Pot: ${game?.pot || 0}</span>
            </div>
            {game?.players && (
              <div className="flex items-center gap-2">
                <span>Players Left: {game.players.filter(p => !p.eliminated).length}</span>
              </div>
            )}
          </div>
        </div>

        {!game && (
          <div className="text-center mb-6">
            <div className="bg-white rounded-xl p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-semibold mb-4 text-black">Ready to Play, {playerName}!</h2>
              <div className="space-y-3">
                <button
                  onClick={() => startNewGame('standard')}
                  className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold"
                >
                  Start Tournament
                </button>
              </div>
            </div>
          </div>
        )}

        {game?.phase === 'tournament_complete' && (
          <div className="text-center mb-6">
            <div className="bg-white rounded-xl p-8 mb-6 shadow-lg border-4 border-yellow-400">
              <div className="flex items-center justify-center gap-3 mb-4">
                <Crown className="w-12 h-12 text-yellow-500" />
                <h2 className="text-3xl font-bold text-black">Tournament Complete!</h2>
                <Crown className="w-12 h-12 text-yellow-500" />
              </div>
              <p className="text-2xl text-black mb-4">
                🏆 <span className="font-bold text-green-600">{game.tournamentWinner?.name}</span> wins the tournament! 🏆
              </p>
              <p className="text-lg text-gray-600 mb-6">
                Final chip count: ${game.tournamentWinner?.chips}
              </p>
              <button
                onClick={() => startNewGame('standard')}
                className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold text-lg"
              >
                Start New Tournament
              </button>
            </div>
          </div>
        )}

        {game && game.phase !== 'tournament_complete' && (
          <>
            <div className="relative max-w-5xl mx-auto mb-6">
              <div className="grid grid-cols-3 grid-rows-3 gap-4 min-h-[600px]">
                
                <div className="flex justify-center">
                  {game.players[3] && (
                    <PlayerCard player={game.players[3]} index={3} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[4] && (
                    <PlayerCard player={game.players[4]} index={4} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[5] && (
                    <PlayerCard player={game.players[5]} index={5} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>

                <div></div>
                
                <div className="bg-green-700 rounded-xl p-6 text-center border-4 border-yellow-400 shadow-2xl">
                  <h2 className="text-xl font-semibold text-white mb-4">Community Cards</h2>
                  <div className="flex justify-center gap-2 mb-4">
                    {game.communityCards.length > 0 ? (
                      game.communityCards.map((card, index) => (
                        <CardComponent key={index} card={card} />
                      ))
                    ) : (
                      <div className="text-white text-lg">Cards will be revealed...</div>
                    )}
                  </div>
                  <div className="text-white">
                    <p className="font-bold">Current Bet: ${game.currentBet} | Total Pot: ${game.winner ? game.pot : game.pot + game.players.reduce((sum, p) => sum + p.bet, 0)}</p>
                    <p className="text-sm">
                      Betting: {game.bettingComplete ? 'Complete' : 'In Progress'} | 
                      Active: {game.winner ? 'Hand Over' : game.players[game.activePlayerIndex]?.name}
                    </p>
                    <p className="text-sm">Hand #{game.handNumber} | Players Left: {game.players.filter(p => !p.eliminated).length}</p>
                    {game.winner && (
                      <p className="text-yellow-300 font-bold text-xl mt-2">
                        🏆 {game.winner.name} wins ${game.pot}!
                      </p>
                    )}
                    {game.phase === 'showdown' && !game.winner && gameLog.some(entry => entry.includes('Split pot!')) && (
                      <p className="text-yellow-300 font-bold text-xl mt-2">
                        🤝 Split Pot!
                      </p>
                    )}
                  </div>
                </div>
                
                <div></div>

                <div className="flex justify-center">
                  {game.players[2] && (
                    <PlayerCard player={game.players[2]} index={2} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[1] && (
                    <PlayerCard player={game.players[1]} index={1} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[0] && (
                    <PlayerCard player={game.players[0]} index={0} game={game} playerName={playerName} showCards={showCards} />
                  )}
                </div>
              </div>
            </div>

            {currentPlayerData?.eliminated && (
              <div className="bg-red-100 border-2 border-red-400 rounded-xl p-6 mb-6 shadow-lg text-center">
                <h2 className="text-2xl font-bold text-red-800 mb-2">
                  💀 You have been eliminated from the tournament!
                </h2>
                <p className="text-red-600">
                  You can continue watching the game or start a new tournament.
                </p>
              </div>
            )}

            {game.phase !== 'showdown' && !game.bettingComplete && isMyTurn && !currentPlayerData?.eliminated && (
              <div className="bg-white rounded-xl p-6 mb-6 shadow-lg text-black">
                <h2 className="text-xl font-semibold mb-4 text-black">
                  Your Turn - {playerName}
                  <span className="text-green-600"> (Make your decision)</span>
                </h2>
                <div className="mb-4 p-3 bg-gray-100 rounded text-black">
                  <p className="text-black"><strong>Current Bet:</strong> ${game.currentBet}</p>
                  <p className="text-black"><strong>Your Bet:</strong> ${currentPlayerData?.bet || 0}</p>
                  <p className="text-black"><strong>Call Amount:</strong> ${Math.max(0, game.currentBet - (currentPlayerData?.bet || 0))}</p>
                  <p className="text-black"><strong>Total Pot:</strong> ${game.pot + game.players.reduce((sum, p) => sum + p.bet, 0)}</p>
                </div>
                
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => handlePlayerAction('fold')}
                    className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Fold
                  </button>
                  
                  {game.currentBet > (currentPlayerData?.bet || 0) && (
                    <button
                      onClick={() => handlePlayerAction('call')}
                      className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Call ${Math.max(0, game.currentBet - (currentPlayerData?.bet || 0))}
                    </button>
                  )}
                  
                  {game.currentBet === (currentPlayerData?.bet || 0) && (
                    <button
                      onClick={() => handlePlayerAction('call')}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Check
                    </button>
                  )}
                  
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={actionAmount}
                      onChange={(e) => setActionAmount(parseInt(e.target.value) || 0)}
                      placeholder="Raise amount"
                      className="px-3 py-2 border border-gray-300 rounded-lg w-32"
                      min={game.currentBet + 10}
                    />
                    <button
                      onClick={() => handlePlayerAction('raise', actionAmount)}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                      disabled={actionAmount <= game.currentBet}
                    >
                      Raise to ${actionAmount}
                    </button>
                  </div>
                  
                  <button
                    onClick={() => handlePlayerAction('allin')}
                    className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    All-In (${(currentPlayerData?.chips || 0) + (currentPlayerData?.bet || 0)})
                  </button>
                </div>
              </div>
            )}

            {game.phase !== 'showdown' && !game.bettingComplete && !isMyTurn && 
             !game.players[game.activePlayerIndex]?.folded && 
             !game.players[game.activePlayerIndex]?.allIn &&
             !game.players[game.activePlayerIndex]?.eliminated &&
             !game.players[game.activePlayerIndex]?.hasActed && (
              <div className="bg-white rounded-xl p-6 mb-6 shadow-lg text-center">
                <h2 className="text-xl font-semibold mb-4 text-black">
                  {game.players[game.activePlayerIndex]?.name} is thinking...
                </h2>
                <div className="flex justify-center items-center gap-2 text-gray-600">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
                  <span>AI player making decision</span>
                </div>
              </div>
            )}

            {(game.bettingComplete || game.phase === 'showdown') && (
              <div className="bg-white rounded-xl p-6 mb-6 shadow-lg text-center">
                <h2 className="text-xl font-semibold mb-4 text-black">
                  {game.phase === 'showdown' ? 'Hand Complete' : 'Betting Round Complete'}
                </h2>
                <p className="text-black mb-4">
                  {game.phase === 'showdown' 
                    ? 'Ready for next hand?' 
                    : 'All players have acted. Continue to next phase.'}
                </p>
              </div>
            )}

            <div className="flex justify-center gap-4 mb-6">
              {game.phase === 'showdown' ? (
                <button
                  onClick={nextHand}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold"
                >
                  Next Hand
                </button>
              ) : (
                <button
                  onClick={advancePhase}
                  className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                    game.bettingComplete
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-400 text-gray-700 cursor-not-allowed'
                  }`}
                  disabled={!game.bettingComplete}
                >
                  Continue to {
                    game.phase === 'preflop' ? 'Flop' :
                    game.phase === 'flop' ? 'Turn' :
                    game.phase === 'turn' ? 'River' : 'Showdown'
                  }
                </button>
              )}
              
              <button
                onClick={() => startNewGame(game.mode)}
                className="bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 transition-colors font-semibold"
              >
                New Tournament
              </button>

              <button
                onClick={() => setShowCards(!showCards)}
                className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-semibold flex items-center gap-2"
              >
                {showCards ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                {showCards ? 'Hide' : 'Show'} Cards
              </button>
            </div>

            <div className="bg-black text-green-300 rounded-xl p-4 font-mono text-sm">
              <h3 className="text-white font-bold mb-3">Tournament Log</h3>
              <div className="h-40 overflow-y-auto space-y-1">
                {gameLog.slice(-20).map((entry, index) => (
                  <div key={index}>{entry}</div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}