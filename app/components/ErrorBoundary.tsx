import React, { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../constants/Colors';

type Props = { children: ReactNode; fallbackMessage?: string };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>😵</Text>
          <Text style={styles.title}>Что-то пошло не так</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage ?? 'Попробуй перезапустить приложение'}
          </Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({ hasError: false, error: null })}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Попробовать снова</Text>
          </TouchableOpacity>
          {__DEV__ && this.state.error && (
            <Text style={styles.debug}>{this.state.error.message}</Text>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  message: { fontSize: 14, color: Colors.text2, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  debug: { fontSize: 10, color: '#DC2626', marginTop: 16, textAlign: 'center' },
});
