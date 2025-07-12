'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Clock, Trophy, Eye, EyeOff } from 'lucide-react';

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
  hasActed: boolean; // Track if player has acted this betting round
}

interface GameState {
  id: string;
  players: Player[];
  communityCards: Card[];
  pot: number;
  currentBet: number;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  activePlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  mode: 'standard' | 'oracle' | 'silent' | 'ritual' | 'nobluff';
  winner?: Player;
  deck: Card[]; // Keep consistent deck
  deckIndex: number; // Track position in deck
  bettingComplete: boolean; // Track if betting round is complete
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
    hasActed: false
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
    bettingComplete: false
  };
}

function dealCards(game: GameState): GameState {
  const newGame = { ...game };
  
  // Deal 2 cards to each player
  newGame.players = newGame.players.map(player => ({
    ...player,
    hand: [newGame.deck[newGame.deckIndex++], newGame.deck[newGame.deckIndex++]],
    folded: false,
    bet: 0,
    hasActed: false
  }));

  // Post blinds
  const smallBlindIndex = (newGame.dealerIndex + 1) % newGame.players.length;
  const bigBlindIndex = (newGame.dealerIndex + 2) % newGame.players.length;
  
  newGame.players[smallBlindIndex].chips -= newGame.smallBlind;
  newGame.players[smallBlindIndex].bet = newGame.smallBlind;
  newGame.players[bigBlindIndex].chips -= newGame.bigBlind;
  newGame.players[bigBlindIndex].bet = newGame.bigBlind;
  
  // CORRECT POKER LOGIC:
  // Small blind still needs to act (hasn't matched current bet)
  newGame.players[smallBlindIndex].hasActed = false;
  // Big blind has posted the full current bet, so counts as having acted initially
  newGame.players[bigBlindIndex].hasActed = true;

  newGame.pot = 0;

  return {
    ...newGame,
    phase: 'preflop',
    activePlayerIndex: (newGame.dealerIndex + 3) % newGame.players.length,
    currentBet: newGame.bigBlind,
    communityCards: [],
    bettingComplete: false
  };
}

function isBettingComplete(game: GameState): boolean {
  const activePlayers = game.players.filter(p => !p.folded && !p.allIn);
  
  // If only one active player, betting is complete
  if (activePlayers.length <= 1) return true;
  
  // Standard check: all active players have acted and matched current bet
  const allActed = activePlayers.every(player => player.hasActed);
  const allMatchCurrentBet = activePlayers.every(player => 
    player.bet === game.currentBet || player.allIn
  );
  
  console.log('Betting complete check:', {
    phase: game.phase,
    activePlayers: activePlayers.map(p => p.name),
    allActed,
    allMatchCurrentBet,
    currentBet: game.currentBet,
    playerBets: activePlayers.map(p => ({ name: p.name, bet: p.bet, hasActed: p.hasActed }))
  });
  
  return allActed && allMatchCurrentBet;
}

function getNextActivePlayer(game: GameState): number {
  let nextIndex = (game.activePlayerIndex + 1) % game.players.length;
  let attempts = 0;
  
  while (attempts < game.players.length) {
    const player = game.players[nextIndex];
    if (!player.folded && !player.allIn) {
      return nextIndex;
    }
    nextIndex = (nextIndex + 1) % game.players.length;
    attempts++;
  }
  
  // If we get here, no valid next player - return current
  return game.activePlayerIndex;
}

// React Component
export default function SustainableIQPoker() {
  const [socket] = useState(() => new MockWebSocket());
  const [game, setGame] = useState<GameState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<string>('');
  const [gameLog, setGameLog] = useState<string[]>([]);
  const [actionAmount, setActionAmount] = useState<number>(0);
  const [showCards, setShowCards] = useState<boolean>(false); // Start with cards HIDDEN

  const playerNames = ['Dealer', 'Small Blind', 'Big Blind', 'UTG', 'Middle Position', 'Cutoff'];

  const addToLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    setGameLog(prev => [...prev.slice(-49), logEntry]);
  }, []);

  const startNewGame = (mode: string = 'standard') => {
    const newGame = initializeGame(playerNames, mode);
    const gameWithCards = dealCards(newGame);
    setGame(gameWithCards);
    addToLog(`New game started`);
    addToLog(`Dealer: ${gameWithCards.players[newGame.dealerIndex].name}`);
    addToLog(`${gameWithCards.players[(newGame.dealerIndex + 1) % newGame.players.length].name} posts small blind (${newGame.smallBlind})`);
    addToLog(`${gameWithCards.players[(newGame.dealerIndex + 2) % newGame.players.length].name} posts big blind (${newGame.bigBlind})`);
    addToLog(`First to act: ${gameWithCards.players[gameWithCards.activePlayerIndex].name}`);
  };

  const handlePlayerAction = (action: string, amount?: number) => {
    if (!game || !currentPlayer) return;

    const playerIndex = game.players.findIndex(p => p.name === currentPlayer);
    if (playerIndex !== game.activePlayerIndex) {
      addToLog(`It's not ${currentPlayer}'s turn!`);
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
          
          // Reset hasActed for other players when there's a raise
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn) {
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
          // Reset hasActed for other players
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn) {
              p.hasActed = false;
            }
          });
        }
        addToLog(`${player.name} goes all-in with ${allInAmount}`);
        break;
    }

    // Check if betting is complete
    newGame.bettingComplete = isBettingComplete(newGame);
    
    if (!newGame.bettingComplete) {
      // Move to next active player
      newGame.activePlayerIndex = getNextActivePlayer(newGame);
    }

    setGame(newGame);
    setActionAmount(newGame.currentBet + 10); // Reset raise amount
  };

  // Improved AI Player Logic with Better Hand Evaluation
  const makeAIDecision = (player: Player, gameState: GameState): { action: string; amount?: number } => {
    const callAmount = gameState.currentBet - player.bet;
    
    // Evaluate hole cards with proper poker logic
    const [card1, card2] = player.hand;
    let handStrength = 0;
    
    // Helper function to get card rank name for logging
    const getCardName = (card: Card) => {
      const rankNames: { [key: number]: string } = {
        14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T'
      };
      return rankNames[card.value] || card.value.toString();
    };
    
    const cardStr = `${getCardName(card1)}${card1.suit}${getCardName(card2)}${card2.suit}`;
    
    // PREMIUM HANDS (Always play aggressively)
    if (card1.value === card2.value) {
      // Pocket pairs
      if (card1.value >= 10) handStrength = 95; // TT+ (premium pairs)
      else if (card1.value >= 7) handStrength = 80; // 77-99 (strong pairs)
      else handStrength = 65; // 22-66 (small pairs)
    }
    // HIGH CARDS
    else if (card1.value >= 14 || card2.value >= 14) {
      // Hands with Ace
      if ((card1.value >= 13 && card2.value >= 13)) {
        handStrength = card1.suit === card2.suit ? 90 : 85; // AK, AQ (suited/offsuit)
      } else if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 80 : 70; // AJ, AT (suited/offsuit)
      } else if ((card1.value >= 9 && card2.value >= 9)) {
        handStrength = card1.suit === card2.suit ? 65 : 50; // A9, A8 (suited/offsuit)
      } else {
        handStrength = card1.suit === card2.suit ? 45 : 30; // Weak ace
      }
    }
    // KING HANDS
    else if (card1.value >= 13 || card2.value >= 13) {
      if ((card1.value >= 12 && card2.value >= 12)) {
        handStrength = card1.suit === card2.suit ? 75 : 65; // KQ
      } else if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 70 : 55; // KJ
      } else if ((card1.value >= 10 && card2.value >= 10)) {
        handStrength = card1.suit === card2.suit ? 60 : 45; // KT
      } else {
        handStrength = card1.suit === card2.suit ? 40 : 25; // Weak king
      }
    }
    // QUEEN/JACK HANDS
    else if (card1.value >= 11 || card2.value >= 11) {
      if ((card1.value >= 11 && card2.value >= 11)) {
        handStrength = card1.suit === card2.suit ? 65 : 50; // QJ
      } else if ((card1.value >= 10 && card2.value >= 10)) {
        handStrength = card1.suit === card2.suit ? 55 : 40; // QT, JT
      } else {
        handStrength = card1.suit === card2.suit ? 35 : 20; // Weak queen/jack
      }
    }
    // SUITED CONNECTORS
    else if (card1.suit === card2.suit && Math.abs(card1.value - card2.value) <= 1) {
      handStrength = Math.max(card1.value, card2.value) * 4; // 98s, 87s, etc.
    }
    // CONNECTORS
    else if (Math.abs(card1.value - card2.value) <= 1) {
      handStrength = Math.max(card1.value, card2.value) * 2.5; // 98o, 87o, etc.
    }
    // TRASH HANDS
    else {
      handStrength = Math.max(card1.value, card2.value); // High card only
    }

    // Post-flop: use actual hand evaluation
    if (gameState.communityCards.length > 0) {
      const handEval = evaluateHand([...player.hand, ...gameState.communityCards]);
      handStrength = handEval.rank * 15 + (handEval.highCard / 14) * 10 + 50;
    }

    // Decision matrix based on hand strength
    const potOdds = callAmount > 0 ? callAmount / (gameState.pot + callAmount + gameState.players.reduce((sum, p) => sum + p.bet, 0)) : 0;
    const betSize = callAmount / Math.max(1, player.chips);
    
    // PREMIUM HANDS (85+): Almost always play
    if (handStrength >= 85) {
      if (Math.random() < 0.85) {
        const raiseAmount = Math.min(
          gameState.currentBet + Math.max(gameState.bigBlind * 3, gameState.pot * 0.5),
          player.chips + player.bet
        );
        return { action: 'raise', amount: raiseAmount };
      }
      return { action: 'call' };
    }
    
    // STRONG HANDS (70-84): Usually play
    if (handStrength >= 70) {
      if (betSize < 0.1 || Math.random() < 0.8) {
        if (Math.random() < 0.3) {
          const raiseAmount = Math.min(gameState.currentBet + gameState.bigBlind * 2, player.chips + player.bet);
          return { action: 'raise', amount: raiseAmount };
        }
        return { action: 'call' };
      }
    }
    
    // DECENT HANDS (50-69): Play if cheap
    if (handStrength >= 50) {
      if (potOdds < 0.3 || betSize < 0.05) {
        return { action: 'call' };
      }
    }
    
    // MARGINAL HANDS (30-49): Only if very cheap
    if (handStrength >= 30) {
      if (potOdds < 0.15 || betSize < 0.02) {
        return { action: 'call' };
      }
    }
    
    // Free play (no bet to call)
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
          const totalBet = Math.min(decision.amount, activePlayer.chips + activePlayer.bet);
          const additionalBet = totalBet - activePlayer.bet;
          newGame.players[playerIndex].chips -= additionalBet;
          newGame.players[playerIndex].bet = totalBet;
          newGame.players[playerIndex].hasActed = true;
          newGame.currentBet = totalBet;
          
          // Reset hasActed for other players
          newGame.players.forEach((p, i) => {
            if (i !== playerIndex && !p.folded && !p.allIn) {
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

    // Check if betting is complete
    newGame.bettingComplete = isBettingComplete(newGame);
    
    // Check if only one player left (everyone else folded) - BUT ONLY if betting is complete
    if (newGame.bettingComplete) {
      const activePlayers = newGame.players.filter(p => !p.folded);
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
    console.log(
      `[AI DEBUG] useEffect triggered. Phase: ${game.phase}, Active: ${activePlayer.name}, HasActed: ${activePlayer.hasActed}, Folded: ${activePlayer.folded}, AllIn: ${activePlayer.allIn}, BettingDone: ${game.bettingComplete}`
    );
    
    // ✅ AUTO-ADVANCE if betting is complete and it's not showdown
    if (
      game.bettingComplete &&
      game.phase !== 'showdown' &&
      !game.winner
    ) {
      console.log('[AI DEBUG] Auto-advancing phase because betting is complete');
      setTimeout(() => advancePhase(), 1000);
      return;
    }
    
    // Early returns for non-actionable states
    if (game.phase === 'showdown' || game.bettingComplete || game.winner) {
      console.log('[AI DEBUG] Exiting early - game in non-actionable state');
      return;
    }
    
    const isHumanPlayer = activePlayer.name === currentPlayer;
    
    // Only act if it's an AI player's turn AND they haven't acted yet
    if (!isHumanPlayer && !activePlayer.folded && !activePlayer.allIn && !activePlayer.hasActed) {
      console.log(`[AI DEBUG] Setting timer for ${activePlayer.name} to act`);
      // AI player's turn - auto-play after short delay
      const timer = setTimeout(() => {
        console.log(`[AI DEBUG] Timer fired for ${activePlayer.name}`);
        setGame(prevGame => {
          if (!prevGame || prevGame.phase === 'showdown' || prevGame.bettingComplete || prevGame.winner) {
            console.log('[AI DEBUG] Aborting AI action due to game state change');
            return prevGame;
          }
          
          // Double-check the current active player state
          const currentActivePlayer = prevGame.players[prevGame.activePlayerIndex];
          if (currentActivePlayer.hasActed || currentActivePlayer.folded || currentActivePlayer.allIn || currentActivePlayer.name === currentPlayer) {
            console.log('[AI DEBUG] Aborting AI action - player state changed');
            return prevGame;
          }
          
          console.log(`[AI DEBUG] Executing AI action for ${currentActivePlayer.name}`);
          return executeAIAction(prevGame);
        });
      }, 1500);
      
      return () => {
        console.log(`[AI DEBUG] Cleaning up timer for ${activePlayer.name}`);
        clearTimeout(timer);
      };
    } else {
      console.log('[AI DEBUG] Not setting timer - conditions not met');
    }
  }, [game?.activePlayerIndex, game?.phase, game?.bettingComplete, game?.winner, currentPlayer]);

  const advancePhase = () => {
    if (!game) return;
    
    // Don't advance if betting isn't complete
    if (!game.bettingComplete && game.phase !== 'showdown') {
      addToLog("Betting round must be completed first!");
      return;
    }

    const newGame = { ...game };
    
    // Collect all bets into pot
    const totalBets = newGame.players.reduce((sum, player) => sum + player.bet, 0);
    newGame.pot += totalBets;
    newGame.players.forEach(player => {
      player.bet = 0;
      player.hasActed = false;
    });
    newGame.currentBet = 0;
    newGame.bettingComplete = false;

    switch (game.phase) {
      case 'preflop':
        // Deal flop (3 cards)
        newGame.communityCards = [
          newGame.deck[newGame.deckIndex++],
          newGame.deck[newGame.deckIndex++],
          newGame.deck[newGame.deckIndex++]
        ];
        newGame.phase = 'flop';
        addToLog('Flop dealt');
        break;
        
      case 'flop':
        // Deal turn (1 card)
        newGame.communityCards.push(newGame.deck[newGame.deckIndex++]);
        newGame.phase = 'turn';
        addToLog('Turn dealt');
        break;
        
      case 'turn':
        // Deal river (1 card)
        newGame.communityCards.push(newGame.deck[newGame.deckIndex++]);
        newGame.phase = 'river';
        addToLog('River dealt');
        break;
        
      case 'river':
        // Showdown
        newGame.phase = 'showdown';
        const activePlayers = newGame.players.filter(p => !p.folded);
        
        if (activePlayers.length === 1) {
          newGame.winner = activePlayers[0];
          newGame.winner.chips += newGame.pot;
          addToLog(`${newGame.winner.name} wins ${newGame.pot} (everyone else folded)`);
        } else {
          // Evaluate hands properly
          const handEvaluations = activePlayers.map(player => ({
            player,
            hand: evaluateHand([...player.hand, ...newGame.communityCards])
          }));
          
          // Sort by hand strength (best first)
          handEvaluations.sort((a, b) => compareHands(a.hand, b.hand));
          
          const winner = handEvaluations[0];
          const second = handEvaluations[1];
          
          // Check for ties
          if (second && compareHands(winner.hand, second.hand) === 0) {
            // Find all tied players
            const tiedPlayers = handEvaluations.filter(
              h => compareHands(h.hand, winner.hand) === 0
            ).map(h => h.player);
            
            const splitAmount = Math.floor(newGame.pot / tiedPlayers.length);
            tiedPlayers.forEach(p => p.chips += splitAmount);
            
            newGame.pot = 0;
            newGame.winner = null; // No single winner
            addToLog(`Split pot! ${tiedPlayers.map(p => p.name).join(' & ')} each win ${splitAmount} with ${winner.hand.name}`);
            
            // Show all hands for transparency
            handEvaluations.forEach(({ player, hand }) => {
              addToLog(`${player.name}: ${hand.name} (${player.hand.map(c => c.rank + c.suit).join(', ')})`);
            });
          } else {
            // Single winner
            newGame.winner = winner.player;
            newGame.winner.chips += newGame.pot;
            addToLog(`${winner.player.name} wins ${newGame.pot} with ${winner.hand.name}`);
            
            // Show all hands for transparency
            handEvaluations.forEach(({ player, hand }) => {
              addToLog(`${player.name}: ${hand.name} (${player.hand.map(c => c.rank + c.suit).join(', ')})`);
            });
          }
        }
        newGame.bettingComplete = true;
        break;
    }

    // Reset active player to left of dealer for new betting round
    if (newGame.phase !== 'showdown') {
      newGame.activePlayerIndex = (newGame.dealerIndex + 1) % newGame.players.length;
      // Find first non-folded player
      while (newGame.players[newGame.activePlayerIndex].folded) {
        newGame.activePlayerIndex = (newGame.activePlayerIndex + 1) % newGame.players.length;
      }
    }
    
    setGame(newGame);
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

  const PlayerCard = ({ player, index, game, currentPlayer, showCards }: { 
    player: Player; 
    index: number; 
    game: GameState; 
    currentPlayer: string;
    showCards: boolean;
  }) => (
    <div
      className={`p-3 rounded-lg shadow-lg border-2 w-48 ${
        player.folded
          ? 'bg-gray-200 border-gray-400'
          : game.activePlayerIndex === index
          ? 'bg-yellow-100 border-yellow-500'
          : player.name === currentPlayer
          ? 'bg-blue-100 border-blue-500'
          : 'bg-white border-gray-300'
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <h3 style={{color: '#000000', fontWeight: 'bold', fontSize: '1rem'}}>{player.name}</h3>
        <div className="flex gap-1">
          {index === game.dealerIndex && (
            <div className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">D</div>
          )}
          {game.activePlayerIndex === index && !player.folded && (
            <div className="bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">TURN</div>
          )}
        </div>
      </div>
      
      <div className="space-y-1 text-xs" style={{ color: '#000' }}>
        <p>Chips: ${player.chips}</p>
        <p>Bet: ${player.bet}</p>
        <p>Status: {player.folded ? 'Folded' : player.allIn ? 'All-In' : 'Active'}</p>
        <p>Action: {player.hasActed ? '✓' : '⏳'}</p>
      </div>

      {/* Player Hand */}
      <div className="mt-2">
        <div className="flex gap-1 justify-center">
          {player.hand.map((card, cardIndex) => (
            <div key={cardIndex} className="transform scale-75">
              <CardComponent
                card={card}
                hidden={player.name !== currentPlayer && !showCards}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Player Selection Screen
  if (!currentPlayer) {
    return (
      <div className="min-h-screen p-8" style={{
        background: `
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0),
          radial-gradient(ellipse at center, #2d5016 0%, #1f3710 60%, #0f1f08 100%)
        `,
        backgroundSize: '25px 25px, 100% 100%'
      }}>
        <div className="max-w-4xl mx-auto space-y-6">
          
          {/* Player Selection Box - NOW AT TOP */}
          <div className="max-w-md mx-auto bg-white rounded-xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-black mb-2">♠ SustainableIQ's Poker ♣</h1>
              <p className="text-red-600 font-bold animate-pulse">Choose your identity for the table</p>
            </div>
            
            <div className="space-y-4">
              <select 
                className="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none text-black bg-white"
                onChange={(e) => setCurrentPlayer(e.target.value)}
                value={currentPlayer}
                style={{ color: '#000000', backgroundColor: '#ffffff' }}
              >
                <option value="" style={{ color: '#666666' }}>-- Select your identity --</option>
                {playerNames.map(name => (
                  <option key={name} value={name} style={{ color: '#000000' }}>{name}</option>
                ))}
              </select>
              
              {currentPlayer && (
                <div className="space-y-3">
                  <button
                    onClick={() => startNewGame('standard')}
                    className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold"
                  >
                    Start Game
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Welcome Text Box - Part 1 */}
          <div className="bg-white rounded-xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
              ♠ Welcome to SustainableIQ's Poker Table ♣
            </h2>
            
            <div className="prose prose-sm max-w-none text-gray-700 space-y-4">
              <p>
                This online poker game wasn't built to rival the world's top poker platforms — it was built as a <em>vibe coding experiment</em>. The goal? To explore how Large Language Models (LLMs) like GPT can be used in creative software development, blending AI decision logic with classic game mechanics. Also because I can't find an honest online poker game out there; if I can build my own, then I know it is honest. That way, I can practice in a safespace. The next step, it to call a LLM to make better logic decisions. NB:I am not showing the tech stack I used to port the game online.
              </p>

              <p>
                THIS GAME MIGHT STILL CONTAIN BUGS - IT IS A WORK IN PROGRESS
              </p>

              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Tech Stack (V1 Build)</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>Frontend:</strong> React (with TailwindCSS styling)</li>
                  <li><strong>Runtime:</strong> Next.js (served locally on <code className="bg-gray-100 px-1 rounded">http://localhost:3000</code>)</li>
                  <li><strong>Development Environment:</strong> Visual Studio Code running on a local PC</li>
                  <li><strong>Logic & AI:</strong> TypeScript + Python-inspired patterns + experimental GPT decision hooks</li>
                  <li><strong>State:</strong> In-memory game logic with mock WebSocket simulation</li>
                  <li><strong>AI Behavior:</strong> Scripted poker logic with a placeholder for future LLM integration</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Welcome Text Box - Part 2 */}
          <div className="bg-white rounded-xl shadow-2xl p-8">
            <div className="prose prose-sm max-w-none text-gray-700 space-y-4">
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">But here's the real miracle:</h3>
                <p className="text-blue-700 text-sm">
                  This entire game, the logic, interface, structure, and flow, was built by someone with zero formal background in computer science or software engineering. Not a single programming or CS course. Just a regular person with strong pattern recognition, a love for systems thinking, and a commitment to vibe coding with AI.
                </p>
                <p className="text-blue-700 mt-2 text-sm">
                  This project is a living proof that we've entered a new era: Where deep curiosity, clean intuition, and aligned tools can carry you further than credentials ever could.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPlayerData = game?.players.find(p => p.name === currentPlayer);
  const isMyTurn = currentPlayerData && game?.players[game.activePlayerIndex]?.name === currentPlayer;

  return (
    <div className="min-h-screen p-4" style={{
      background: `
        radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0),
        radial-gradient(ellipse at center, #2d5016 0%, #1f3710 60%, #0f1f08 100%)
      `,
      backgroundSize: '25px 25px, 100% 100%'
    }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-white mb-2">♠ SustainableIQ's Poker Table ♣</h1>
          <div className="flex justify-center items-center gap-4 text-white">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <span>Mode: {game?.mode.toUpperCase() || 'WAITING'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              <span>Phase: {game?.phase.toUpperCase() || 'WAITING'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              <span>Pot: ${game?.pot || 0}</span>
            </div>
          </div>
        </div>

        {/* Show game selection if no game */}
        {!game && (
          <div className="text-center mb-6">
            <div className="bg-white rounded-xl p-6 mb-6 shadow-lg">
              <h2 className="text-xl font-semibold mb-4 text-black">Ready to Play, {currentPlayer}!</h2>
              <div className="space-y-3">
                <button
                  onClick={() => startNewGame('standard')}
                  className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold"
                >
                  Start Game
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game Table - Only show if game exists */}
        {game && (
          <>
            {/* Poker Table Layout */}
            <div className="relative max-w-5xl mx-auto mb-6">
              {/* Table Layout Grid */}
              <div className="grid grid-cols-3 grid-rows-3 gap-4 min-h-[600px]">
                
                {/* Top Row - Positions 3, 4, 5 */}
                <div className="flex justify-center">
                  {game.players[3] && (
                    <PlayerCard player={game.players[3]} index={3} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[4] && (
                    <PlayerCard player={game.players[4]} index={4} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[5] && (
                    <PlayerCard player={game.players[5]} index={5} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>

                {/* Middle Row - Empty, Center Table, Empty */}
                <div></div>
                
                {/* CENTER TABLE - Community Cards & Game Info */}
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
                      Active: {game.winner ? 'Game Over' : game.players[game.activePlayerIndex]?.name}
                    </p>
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

                {/* Bottom Row - Positions 2, 1, 0 */}
                <div className="flex justify-center">
                  {game.players[2] && (
                    <PlayerCard player={game.players[2]} index={2} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[1] && (
                    <PlayerCard player={game.players[1]} index={1} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>
                <div className="flex justify-center">
                  {game.players[0] && (
                    <PlayerCard player={game.players[0]} index={0} game={game} currentPlayer={currentPlayer} showCards={showCards} />
                  )}
                </div>
              </div>
            </div>

            {/* Player Actions - Only show when it's human player's turn */}
            {game.phase !== 'showdown' && !game.bettingComplete && isMyTurn && (
              <div className="bg-white rounded-xl p-6 mb-6 shadow-lg text-black">
                <h2 className="text-xl font-semibold mb-4 text-black">
                  Your Turn - {currentPlayer}
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

            {/* AI Player Thinking - Show when it's AI's turn and they haven't acted yet */}
            {game.phase !== 'showdown' && !game.bettingComplete && !isMyTurn && 
             !game.players[game.activePlayerIndex]?.folded && 
             !game.players[game.activePlayerIndex]?.allIn &&
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

            {/* Betting Complete - Show continue button */}
            {(game.bettingComplete || game.phase === 'showdown') && (
              <div className="bg-white rounded-xl p-6 mb-6 shadow-lg text-center">
                <h2 className="text-xl font-semibold mb-4 text-black">
                  {game.phase === 'showdown' ? 'Hand Complete' : 'Betting Round Complete'}
                </h2>
                <p className="text-black mb-4">
                  {game.phase === 'showdown' 
                    ? 'Start a new hand when ready.' 
                    : 'All players have acted. Continue to next phase.'}
                </p>
              </div>
            )}

            {/* Game Controls */}
            <div className="flex justify-center gap-4 mb-6">
              <button
                onClick={advancePhase}
                className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                  game.bettingComplete || game.phase === 'showdown'
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-400 text-gray-700 cursor-not-allowed'
                }`}
                disabled={!game.bettingComplete && game.phase !== 'showdown'}
              >
                {game.phase === 'showdown' ? 'Show Results' : `Continue to ${
                  game.phase === 'preflop' ? 'Flop' :
                  game.phase === 'flop' ? 'Turn' :
                  game.phase === 'turn' ? 'River' : 'Showdown'
                }`}
              </button>
              
              <button
                onClick={() => startNewGame(game.mode)}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-semibold"
              >
                New Hand
              </button>

              <button
                onClick={() => setShowCards(!showCards)}
                className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-semibold flex items-center gap-2"
              >
                {showCards ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                {showCards ? 'Hide' : 'Show'} Cards
              </button>
            </div>

            {/* Game Log */}
            <div className="bg-black text-green-300 rounded-xl p-4 font-mono text-sm">
              <h3 className="text-white font-bold mb-3">Game Log</h3>
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