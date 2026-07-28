import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native"
import { WebView } from "react-native-webview"

type Props = { url: string | null; onClose: () => void }

/**
 * 외부 도메인 전용 웹뷰. 상단 닫기 바를 둔다 —
 * 외부 사이트에서 히스토리가 꼬여도 사용자가 항상 빠져나올 수 있어야 한다.
 */
export function ModalWebView({ url, onClose }: Props) {
  return (
    <Modal visible={url !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="닫기">
            <Text style={styles.close}>닫기</Text>
          </Pressable>
        </View>
        {url ? <WebView source={{ uri: url }} /> : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  close: { fontSize: 16, fontWeight: "600" },
})
