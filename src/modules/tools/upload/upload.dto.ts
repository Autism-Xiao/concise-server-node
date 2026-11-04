import { ApiProperty } from '@nestjs/swagger'

export class FileUploadDto {
  @ApiProperty({ type: 'string', format: 'binary', description: '上传的文件（表单字段名 file）' })
  file: Express.Multer.File
}
