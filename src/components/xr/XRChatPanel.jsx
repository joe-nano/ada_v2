import React from 'react';
import { Container, Text } from '@react-three/uikit';

/**
 * XRChatPanel — Simplified chat display for immersive XR sessions.
 *
 * Shows the last N messages as Text elements. Voice-only input in V1
 * (no virtual keyboard). A speaking indicator pulses when the AI is talking.
 */

const MAX_MESSAGES = 5;

export default function XRChatPanel({ messages = [], isSpeakingRef }) {
  const recent = messages.slice(-MAX_MESSAGES);
  const isSpeaking = isSpeakingRef?.current || false;

  return (
    <Container flexDirection="column" gap={6} width="100%">
      {/* Speaking indicator */}
      <Container
        flexDirection="row"
        alignItems="center"
        gap={6}
        height={20}
        marginBottom={4}
      >
        <Container
          width={8}
          height={8}
          borderRadius={4}
          backgroundColor={isSpeaking ? '#00FFFF' : '#334155'}
        />
        <Text
          fontSize={10}
          color={isSpeaking ? '#22d3ee' : '#64748b'}
          fontWeight="medium"
        >
          {isSpeaking ? 'JODA is speaking...' : 'Listening (voice input)'}
        </Text>
      </Container>

      {/* Messages */}
      {recent.length === 0 ? (
        <Container height={40} alignItems="center" justifyContent="center">
          <Text fontSize={11} color="#475569">No messages yet</Text>
        </Container>
      ) : (
        recent.map((msg, i) => (
          <Container
            key={i}
            flexDirection="column"
            gap={2}
            paddingBottom={4}
            borderBottomWidth={i < recent.length - 1 ? 1 : 0}
            borderColor="rgba(148, 163, 184, 0.15)"
          >
            <Text
              fontSize={9}
              color={msg.sender === 'You' ? '#60a5fa' : '#22d3ee'}
              fontWeight="bold"
            >
              {msg.sender}
            </Text>
            <Text
              fontSize={11}
              color="#e2e8f0"
              wordBreak="break-word"
            >
              {(msg.text || '').slice(0, 200)}
              {(msg.text || '').length > 200 ? '...' : ''}
            </Text>
          </Container>
        ))
      )}
    </Container>
  );
}
