// create-kafka-topics.js
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'topic-creator',
  brokers: ['localhost:9092'],
});

const admin = kafka.admin();

async function createTopics() {
  try {
    await admin.connect();
    console.log('Kafka Admin 연결 성공');

    const topics = [
      'user.verification',
      'user.find.id',
      'user.reset.password',
      'user.created',
      'user.updated',
      'user.deleted'
    ];

    await admin.createTopics({
      topics: topics.map(topic => ({
        topic,
        numPartitions: 3,
        replicationFactor: 1
      }))
    });

    console.log('✅ 모든 토픽이 생성되었습니다:', topics);

  } catch (error) {
    console.error('❌ 토픽 생성 실패:', error.message);
  } finally {
    await admin.disconnect();
  }
}

createTopics();
