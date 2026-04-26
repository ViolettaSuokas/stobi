import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaretLeft } from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';

export default function TermsScreen() {
  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Terms of Use</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.updated}>Last updated: April 22, 2026</Text>

        <Text style={styles.h2}>1. Acceptance</Text>
        <Text style={styles.p}>
          By using Stobi, you agree to these terms. If you don't agree, please don't use the app.
        </Text>

        <Text style={styles.h2}>2. The Service</Text>
        <Text style={styles.p}>
          Stobi is a community app for finding and hiding painted stones. You can:{'\n\n'}
          • Hide painted stones and share their approximate location{'\n'}
          • Find stones hidden by others{'\n'}
          • Earn diamonds (💎) and customize your stone character{'\n'}
          • Chat with the community
        </Text>

        <Text style={styles.h2}>3. Your Account</Text>
        <Text style={styles.p}>
          You're responsible for your account security. Don't share your login credentials. You can delete your account at any time from Settings.
        </Text>

        <Text style={styles.h2}>4. Content Rules</Text>
        <Text style={styles.p}>
          When using Stobi, you must not:{'\n\n'}
          • Post offensive, hateful, or inappropriate content{'\n'}
          • Share spam, links, or advertisements in chat{'\n'}
          • Use fake GPS or cheat the diamond system{'\n'}
          • Create multiple accounts to exploit the find/hide rewards{'\n'}
          • Hide stones in dangerous or private locations{'\n'}
          • Impersonate other users
        </Text>

        <Text style={styles.h2}>5. Diamonds & Premium</Text>
        <Text style={styles.p}>
          Diamonds (💎) are a virtual currency earned through gameplay. They have no real-world monetary value and cannot be exchanged for money. Premium subscriptions are non-refundable except as required by law.
        </Text>

        <Text style={styles.h2}>6. Content Ownership</Text>
        <Text style={styles.p}>
          You own the photos you take. By posting them in Stobi, you grant us a license to display them within the app. We won't use your content outside of Stobi without permission.
        </Text>

        <Text style={styles.h2}>7. Moderation</Text>
        <Text style={styles.p}>
          We may remove content or suspend accounts that violate these terms. Users can report inappropriate content using the long-press menu in chat.
        </Text>

        <Text style={styles.h2}>8. Liability</Text>
        <Text style={styles.p}>
          Stobi is provided "as is". We're not responsible for:{'\n\n'}
          • Stones that go missing or get damaged{'\n'}
          • Inaccurate GPS locations{'\n'}
          • Interactions between users{'\n'}
          • Service interruptions
        </Text>

        <Text style={styles.h2}>9. Changes</Text>
        <Text style={styles.p}>
          We may update these terms. Continued use of Stobi means you accept the updated terms.
        </Text>

        <Text style={styles.h2}>10. Contact</Text>
        <Text style={styles.p}>
          Questions? Email us at:{'\n'}
          violettasuokas@gmail.com
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  // Унифицированный header — такой же как в diamond-history / notifications.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: Colors.text },
  scroll: { paddingHorizontal: 24, paddingTop: 8 },
  updated: { fontSize: 12, color: Colors.text2, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 20, marginBottom: 8 },
  p: { fontSize: 14, lineHeight: 22, color: Colors.text2 },
});
