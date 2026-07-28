import { Pressable, StyleSheet, Text, View } from "react-native"

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>연결할 수 없습니다</Text>
      <Text style={styles.body}>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</Text>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.buttonText}>다시 시도</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  body: { marginTop: 8, fontSize: 14, color: "#666", textAlign: "center" },
  button: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#111",
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
})
