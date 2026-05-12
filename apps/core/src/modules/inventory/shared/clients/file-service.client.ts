// import { Injectable } from '@nestjs/common';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';

// @Injectable()
// export class FileServiceClient {
//   constructor(private readonly httpService: HttpService) {}

//   async getFileUrl(uploadId: string): Promise<string> {
//     const fileServiceUrl = process.env.FILE_SERVICE_URL || 'http://localhost:3005';

//     const response = await firstValueFrom(
//       this.httpService.get(
//         `${fileServiceUrl}/api/v1/files/${uploadId}/metadata`
//       )
//     );

//     return response.data.url;
//   }

//   async getSignedUrl(uploadId: string, expiresIn: number = 3600): Promise<string> {
//     const fileServiceUrl = process.env.FILE_SERVICE_URL || 'http://localhost:3005';

//     const response = await firstValueFrom(
//       this.httpService.get(
//         `${fileServiceUrl}/api/v1/files/${uploadId}/download`,
//         { params: { expiresIn } }
//       )
//     );

//     return response.data.signedUrl;
//   }

//   async getBatchFileUrls(uploadIds: string[]): Promise<Record<string, string>> {
//     const urls: Record<string, string> = {};

//     await Promise.all(
//       uploadIds.map(async (uploadId) => {
//         try {
//           urls[uploadId] = await this.getFileUrl(uploadId);
//         } catch (error) {
//           urls[uploadId] = '';
//         }
//       })
//     );

//     return urls;
//   }
// }
