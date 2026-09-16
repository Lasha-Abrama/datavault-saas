import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class AwsS3Service {
    private storageService;
    private bucketName


    constructor(){
        this.bucketName = process.env.AWS_BUCKET_NAME
        this.storageService = new S3Client({
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            region: process.env.AWS_REGION
        })
    }


    async uploadImage(filePath: string, file){
        if(!filePath || !file) throw new BadRequestException('File is required')
        try{
            const config = {
                Key: filePath,
                Bucket: this.bucketName,
                Body: file.buffer,
                ContentType: file.mimetype,
            }
            const uploadCommand = new PutObjectCommand(config)
            await this.storageService.send(uploadCommand)
            return filePath
        }catch(e){
            console.log(e, "eent")
            throw new BadRequestException('Could not upload file')
        }
    }


    async getFile(filePath: string){
        if(!filePath) throw new BadRequestException('File path is required')
        return `${process.env.CLOUD_FRONT_URL}/${filePath}`
    }


    async deleteImg(filePath: string){
        if(!filePath) throw new BadRequestException('File path is required')
        const config = {
            Bucket: this.bucketName,
            Key: filePath
        } 
        const deleteCommand = new DeleteObjectCommand(config)
        await this.storageService.send(deleteCommand)
        return 'deleted successfully'
    }


}