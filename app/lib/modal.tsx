import React, { createContext, useContext, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { Colors } from '../constants/Colors';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

type ButtonStyle = 'default' | 'cancel' | 'destructive';

type ModalButton = {
  label: string;
  style?: ButtonStyle;
  onPress?: (inputValue?: string) => void;
};

type ModalConfig = {
  title: string;
  message?: string;
  buttons: ModalButton[];
  /** If set, shows a text input field */
  input?: {
    placeholder?: string;
    defaultValue?: string;
  };
  /** Optional React element rendered above the title (mascot, icon, etc.) */
  illustration?: React.ReactNode;
};

type ModalContextType = {
  show: (config: ModalConfig) => void;
};

// ────────────────────────────────────────────
// Context
// ────────────────────────────────────────────

const ModalContext = createContext<ModalContextType>({
  show: () => {},
});

export function useModal() {
  return useContext(ModalContext);
}

// ────────────────────────────────────────────
// Provider + Renderer
// ────────────────────────────────────────────

export function ModalProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ModalConfig | null>(null);
  const [inputValue, setInputValue] = useState('');

  const show = (cfg: ModalConfig) => {
    setConfig(cfg);
    setInputValue(cfg.input?.defaultValue ?? '');
  };

  const close = () => setConfig(null);

  const handlePress = (btn: ModalButton) => {
    // Snapshot inputValue before we close — close() schedules a state
    // reset and closures on `inputValue` could read stale state.
    const value = inputValue;
    close();
    // Use microtask (requestAnimationFrame via Promise.resolve) instead of
    // a 50ms timer. The 50ms felt like UI lag on every modal dismiss.
    Promise.resolve().then(() => {
      try {
        btn.onPress?.(value);
      } catch (e) {
        console.error('modal button onPress error', e);
      }
    });
  };

  return (
    <ModalContext.Provider value={{ show }}>
      {children}

      <Modal
        visible={config !== null}
        transparent
        animationType="fade"
        onRequestClose={close}
        // iOS: без overFullScreen кастомная модалка не показывается поверх
        // экранов с presentation:'modal' (settings, premium, stone detail).
        // Из-за этого язык в settings не был кликабельным — модалка
        // открывалась за stack-модалкой.
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            {/* Illustration */}
            {config?.illustration && (
              <View style={styles.illustration}>{config.illustration}</View>
            )}

            {/* Title */}
            <Text style={styles.title}>{config?.title}</Text>

            {/* Message */}
            {config?.message && (
              <Text style={styles.message}>{config.message}</Text>
            )}

            {/* Input field */}
            {config?.input && (
              <TextInput
                style={styles.input}
                value={inputValue}
                onChangeText={setInputValue}
                placeholder={config.input.placeholder}
                placeholderTextColor={Colors.text2}
                autoFocus
              />
            )}

            {/* Buttons */}
            <View style={styles.buttons}>
              {config?.buttons.map((btn, i) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.btn,
                      isDestructive && styles.btnDestructive,
                      isCancel && styles.btnCancel,
                      !isDestructive && !isCancel && styles.btnDefault,
                    ]}
                    onPress={() => handlePress(btn)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        isDestructive && styles.btnTextDestructive,
                        isCancel && styles.btnTextCancel,
                        !isDestructive && !isCancel && styles.btnTextDefault,
                      ]}
                    >
                      {btn.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ModalContext.Provider>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(26,26,46,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 16,
  },
  illustration: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  buttons: {
    gap: 10,
  },
  btn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDefault: {
    backgroundColor: Colors.accent,
  },
  btnDestructive: {
    backgroundColor: '#FEE2E2',
  },
  btnCancel: {
    backgroundColor: Colors.surface2,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  btnTextDefault: {
    color: '#FFFFFF',
  },
  btnTextDestructive: {
    color: '#DC2626',
  },
  btnTextCancel: {
    color: Colors.text2,
  },
});
