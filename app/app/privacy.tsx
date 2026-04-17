import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaretLeft } from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';

export default function PrivacyScreen() {
  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Privacy Policy</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.updated}>Last updated: April 17, 2026</Text>

        <Text style={styles.h2}>1. What We Collect</Text>
        <Text style={styles.p}>
          Stobi collects the minimum data needed to operate the app:{'\n\n'}
          • <Text style={styles.b}>Account info</Text> — email, username, profile photo (when you create an account){'\n'}
          • <Text style={styles.b}>Location data</Text> — GPS coordinates to show nearby stones and verify finds (only while using the app){'\n'}
          • <Text style={styles.b}>Photos</Text> — stone photos you take when hiding or finding stones{'\n'}
          • <Text style={styles.b}>Chat messages</Text> — text and photos you send in community chat{'\n'}
          • <Text style={styles.b}>Usage data</Text> — anonymous analytics (app opens, features used)
        </Text>

        <Text style={styles.h2}>2. How We Use Your Data</Text>
        <Text style={styles.p}>
          • Show painted stones near you on the map{'\n'}
          • Verify that you're physically near a stone when claiming a find{'\n'}
          • Display your profile and messages to other users{'\n'}
          • Track achievements and diamond balance{'\n'}
          • Improve the app experience
        </Text>

        <Text style={styles.h2}>3. Data Sharing</Text>
        <Text style={styles.p}>
          We do not sell your personal data. Your data is shared only with:{'\n\n'}
          • <Text style={styles.b}>Supabase</Text> — database and authentication provider{'\n'}
          • <Text style={styles.b}>Google/Apple</Text> — if you sign in with these providers{'\n'}
          • <Text style={styles.b}>Other users</Text> — your username, photo, and chat messages are visible to the community
        </Text>

        <Text style={styles.h2}>4. Data Storage</Text>
        <Text style={styles.p}>
          Your data is stored on Supabase servers (AWS, EU region) and locally on your device. We use encryption in transit (HTTPS) and at rest.
        </Text>

        <Text style={styles.h2}>5. Your Rights</Text>
        <Text style={styles.p}>
          You can:{'\n\n'}
          • <Text style={styles.b}>View</Text> your data in the Profile section{'\n'}
          • <Text style={styles.b}>Edit</Text> your username, photo, and bio at any time{'\n'}
          • <Text style={styles.b}>Delete</Text> your account and all data (Settings → Delete Account){'\n'}
          • <Text style={styles.b}>Export</Text> — contact us for a data export
        </Text>

        <Text style={styles.h2}>6. Children</Text>
        <Text style={styles.p}>
          Stobi is designed for all ages. We do not knowingly collect personal data from children under 13 without parental consent. If you believe a child has provided us data, contact us.
        </Text>

        <Text style={styles.h2}>7. Contact</Text>
        <Text style={styles.p}>
          Questions about privacy? Email us at:{'\n'}
          violettasuokas@gmail.com
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  scroll: { paddingHorizontal: 24, paddingTop: 8 },
  updated: { fontSize: 12, color: Colors.text2, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 20, marginBottom: 8 },
  p: { fontSize: 14, lineHeight: 22, color: Colors.text2 },
  b: { fontWeight: '600', color: Colors.text },
});
