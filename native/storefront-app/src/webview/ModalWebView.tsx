import { Modal, Pressable, StyleSheet, Text, View } from "react-native"
// App.tsx 와 같은 이유로 `react-native` 내장 SafeAreaView 를 쓰지 않는다(Android no-op).
// 이 모달은 결제 등 외부 도메인을 띄우므로 닫기 바가 상태바에 깔리면 빠져나갈 수 없게 된다.
//
// App.tsx 와 달리 **하단도 인셋한다**(edges 기본값 = 전체). 여기 뜨는 건 우리 storefront 가
// 아니라 임의의 외부 사이트라 safe-area 를 처리한다는 보장이 없다. 겹칠 위험보다 결제
// 페이지의 버튼이 시스템 바에 깔릴 위험이 크다.
import { SafeAreaView } from "react-native-safe-area-context"
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
  root: { flex: 1, backgroundColor: "#fff" },
  bar: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  close: { fontSize: 16, fontWeight: "600" },
})
