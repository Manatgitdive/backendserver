require('dotenv').config();
const AWS = require('aws-sdk');
const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();

// Environment variables
const port = process.env.PORT || 8080;
const bucketName = process.env.AWS_BUCKET_NAME || 'images-b1-friendcity';
const cloudFrontUrl = process.env.CLOUDFRONT_URL || 'https://d1abza710rbese.cloudfront.net';

// AWS Configuration using environment variables
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Expose-Headers', 'Content-Length');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Password protection page
app.get('/view/:filename', (req, res) => {
    const filename = req.params.filename;
    const password = req.query.password;
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Protected Document Access</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
            <h1 class="text-2xl font-bold mb-6 text-center">Access Protected File</h1>
            
            <form id="accessForm" class="space-y-6">
                <div>
                    <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Access Password</label>
                    <input 
                        type="password" 
                        id="password" 
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter your access password"
                        required
                    >
                </div>
                
                <div id="errorMessage" class="text-red-600 text-sm hidden">
                    Incorrect password. Please try again.
                </div>

                <div id="successMessage" class="text-green-600 text-sm hidden">
                    Password verified! Redirecting to file...
                </div>
                
                <button 
                    type="submit"
                    class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                    Access File
                </button>
            </form>

            <script>
                const form = document.getElementById('accessForm');
                const passwordInput = document.getElementById('password');
                const errorMessage = document.getElementById('errorMessage');
                const successMessage = document.getElementById('successMessage');
                const expectedPassword = '${password || ""}';
                const filename = '${filename}';

                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    errorMessage.classList.add('hidden');
                    successMessage.classList.add('hidden');

                    const enteredPassword = passwordInput.value;

                    if (enteredPassword === expectedPassword) {
                        successMessage.classList.remove('hidden');
                        setTimeout(() => {
                            window.location.href = '${cloudFrontUrl}/uploads/' + filename;
                        }, 1500);
                    } else {
                        errorMessage.classList.remove('hidden');
                        passwordInput.value = '';
                    }
                });
            </script>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// File upload configuration
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'video/mp4',
            'video/quicktime',
            'video/x-msvideo',
            'video/webm',
            'image/jpeg',
            'image/png'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type. Allowed types are: PDF, DOC, DOCX, MP4, MOV, AVI, WEBM, JPEG, and PNG`), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// Upload endpoint
app.post('/upload-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const fileExtension = path.extname(req.file.originalname);
        const filename = `${Date.now()}-${Math.round(Math.random() * 1000)}${fileExtension}`;
        const contentDisposition = `attachment; filename="${encodeURIComponent(req.file.originalname)}"`;

        const params = {
            Bucket: bucketName,
            Key: `uploads/${filename}`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
            ContentDisposition: contentDisposition,
            CacheControl: 'max-age=31536000'
        };

        // For large files, use multipart upload
        if (req.file.size > 5 * 1024 * 1024) {
            const multipartParams = {
                ...params,
                ACL: 'public-read',
                Metadata: {
                    'original-filename': req.file.originalname
                }
            };

            const uploadResult = await s3.upload(multipartParams).promise();
            
            res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                s3Url: uploadResult.Location,
                cloudFrontUrl: `${cloudFrontUrl}/uploads/${filename}`,
                protectedUrl: `${req.protocol}://${req.get('host')}/view/${filename}`,
                filename: filename,
                fileType: req.file.mimetype,
                originalName: req.file.originalname
            });
        } else {
            const uploadResult = await s3.upload(params).promise();

            res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                s3Url: uploadResult.Location,
                cloudFrontUrl: `${cloudFrontUrl}/uploads/${filename}`,
                protectedUrl: `${req.protocol}://${req.get('host')}/view/${filename}`,
                filename: filename,
                fileType: req.file.mimetype,
                originalName: req.file.originalname
            });
        }

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({
            success: false,
            error: 'Error uploading file',
            details: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File size is too large. Maximum size is 100MB'
            });
        }
    }
    
    return res.status(500).json({
        success: false,
        error: error.message
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});